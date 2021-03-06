/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
import * as bodyPix from '@tensorflow-models/body-pix';
import dat from 'dat.gui';
import Stats from 'stats.js';

import { toggleLoadingUI } from './demo-util';

const stats = new Stats();

const state = {
  video: null,
  stream: null,
  net: null,
  videoConstraints: {},
  // Triggers the TensorFlow model to reload
  changingArchitecture: false,
  changingMultiplier: false,
  changingStride: false,
  changingResolution: false,
  changingQuantBytes: false
};

async function getVideoInputs() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    console.log('enumerateDevices() not supported.');
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  const videoDevices = devices.filter((device) => device.kind === 'videoinput');

  return videoDevices;
}

function stopExistingVideoCapture() {
  if (state.video && state.video.srcObject) {
    state.video.srcObject.getTracks().forEach((track) => {
      track.stop();
    });
    state.video.srcObject = null;
  }
}

async function getDeviceIdForLabel(cameraLabel) {
  const videoInputs = await getVideoInputs();

  for (let i = 0; i < videoInputs.length; i++) {
    const videoInput = videoInputs[i];
    if (videoInput.label === cameraLabel) {
      return videoInput.deviceId;
    }
  }
  return null;
}

// on mobile, facing mode is the preferred way to select a camera.
// Here we use the camera label to determine if its the environment or
// user facing camera
function getFacingMode(cameraLabel) {
  if (!cameraLabel) {
    return 'user';
  }
  if (cameraLabel.toLowerCase().includes('back')) {
    return 'environment';
  } else {
    return 'user';
  }
}

async function getConstraints(cameraLabel) {
  let deviceId;
  let facingMode;

  if (cameraLabel) {
    deviceId = await getDeviceIdForLabel(cameraLabel);
    // on mobile, use the facing mode based on the camera.
    // facingMode = isMobile() ? getFacingMode(cameraLabel) : null;
  }
  return { deviceId, facingMode };
}

/**
 * Loads a the camera to be used in the demo
 *
 */
async function setupCamera(cameraLabel) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      'Browser API navigator.mediaDevices.getUserMedia not available'
    );
  }

  const videoElement = document.getElementById('video');

  stopExistingVideoCapture();

  const videoConstraints = await getConstraints(cameraLabel);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints
  });
  videoElement.srcObject = stream;

  return new Promise((resolve) => {
    videoElement.onloadedmetadata = () => {
      videoElement.width = videoElement.videoWidth;
      videoElement.height = videoElement.videoHeight;
      resolve(videoElement);
    };
  });
}

async function loadVideo(cameraLabel) {
  try {
    state.video = await setupCamera(cameraLabel);
  } catch (e) {
    let info = document.getElementById('info');
    info.textContent =
      'this browser does not support video capture,' +
      'or this device does not have a camera';
    info.style.display = 'block';
    throw e;
  }

  state.video.play();
}

const defaultQuantBytes = 2;

const defaultMobileNetMultiplier = 0.5;
const defaultMobileNetStride = 16;
const defaultMobileNetInternalResolution = 'medium';

const defaultResNetMultiplier = 1.0;
const defaultResNetStride = 16;
const defaultResNetInternalResolution = 'low';

const guiState = {
  algorithm: 'person',
  estimate: 'segmentation',
  camera: null,
  flipHorizontal: false,
  input: {
    architecture: 'MobileNetV1',
    outputStride: 16,
    internalResolution: 'low',
    multiplier: 0.5,
    quantBytes: 2
  },
  multiPersonDecoding: {
    maxDetections: 2,
    scoreThreshold: 0.3,
    nmsRadius: 20,
    numKeypointForMatching: 17,
    numKeypointForMatching: 17,
    refineSteps: 10
  },
  segmentation: {
    segmentationThreshold: 0.5,
    effect: 'bokeh',
    maskBackground: true,
    opacity: 0.7,
    backgroundBlurAmount: 10,
    maskBlurAmount: 0,
    edgeBlurAmount: 3
  },
  showFps: true
};

function toCameraOptions(cameras) {
  const result = { default: null };

  cameras.forEach((camera) => {
    result[camera.label] = camera.label;
  });

  return result;
}

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras) {
  const gui = new dat.GUI({ width: 300 });

  let architectureController = null;

  gui
    .add(guiState, 'camera', toCameraOptions(cameras))
    .onChange(async function (cameraLabel) {
      state.changingCamera = true;

      await loadVideo(cameraLabel);

      state.changingCamera = false;
    });

  // The 'person' algorithm returns one single segmentation mask (or body
  // part map) for all people in the image.
  const algorithmController = gui.add(guiState, 'algorithm', 'person');

  // Architecture: there are a few BodyPix models varying in size and
  // accuracy.
  // The input parameters have the most effect on accuracy and speed of the
  // network
  let input = gui.addFolder('Input');

  // Updates outputStride
  // Output stride:  Internally, this parameter affects the height and width
  // of the layers in the neural network. The lower the value of the output
  // stride the higher the accuracy but slower the speed, the higher the
  // value the faster the speed but lower the accuracy.
  let outputStrideController = null;
  function updateGuiOutputStride(outputStride, outputStrideArray) {
    if (outputStrideController) {
      outputStrideController.remove();
    }
    guiState.input.outputStride = outputStride;
    outputStrideController = input.add(
      guiState.input,
      'outputStride',
      outputStrideArray
    );
    outputStrideController.onChange(function (outputStride) {
      state.changingStride = true;
      guiState.input.outputStride = +outputStride;
    });
  }

  // Updates internal resolution
  // Internal resolution:  Internally, this parameter affects the height and
  // width of the layers in the neural network. The higher the value of the
  // internal resolution the better the accuracy but slower the speed.
  let internalResolutionController = null;
  function updateGuiInternalResolution(
    internalResolution,
    internalResolutionArray
  ) {
    if (internalResolutionController) {
      internalResolutionController.remove();
    }
    guiState.input.internalResolution = internalResolution;
    internalResolutionController = input.add(
      guiState.input,
      'internalResolution',
      internalResolutionArray
    );
    internalResolutionController.onChange(function (internalResolution) {
      guiState.input.internalResolution = internalResolution;
    });
  }

  // Updates depth multiplier
  // Multiplier: this parameter affects the number of feature map channels
  // in the MobileNet. The higher the value, the higher the accuracy but
  // slower the speed, the lower the value the faster the speed but lower
  // the accuracy.
  let multiplierController = null;
  function updateGuiMultiplier(multiplier, multiplierArray) {
    if (multiplierController) {
      multiplierController.remove();
    }
    guiState.input.multiplier = multiplier;
    multiplierController = input.add(
      guiState.input,
      'multiplier',
      multiplierArray
    );
    multiplierController.onChange(function (multiplier) {
      state.changingMultiplier = true;
      guiState.input.multiplier = +multiplier;
    });
  }

  // updates quantBytes
  // QuantBytes: this parameter affects weight quantization in the ResNet50
  // model. The available options are 1 byte, 2 bytes, and 4 bytes. The
  // higher the value, the larger the model size and thus the longer the
  // loading time, the lower the value, the shorter the loading time but
  // lower the accuracy.
  let quantBytesController = null;
  function updateGuiQuantBytes(quantBytes, quantBytesArray) {
    if (quantBytesController) {
      quantBytesController.remove();
    }
    guiState.quantBytes = +quantBytes;
    guiState.input.quantBytes = +quantBytes;
    quantBytesController = input.add(
      guiState.input,
      'quantBytes',
      quantBytesArray
    );
    quantBytesController.onChange(function (quantBytes) {
      state.changingQuantBytes = true;
      guiState.input.quantBytes = +quantBytes;
    });
  }

  function updateGuiInputSection() {
    if (guiState.input.architecture === 'MobileNetV1') {
      updateGuiInternalResolution(defaultMobileNetInternalResolution, [
        'low',
        'medium',
        'high',
        'full'
      ]);
      updateGuiOutputStride(defaultMobileNetStride, [8, 16]);
      updateGuiMultiplier(defaultMobileNetMultiplier, [0.5, 0.75, 1.0]);
    } else {
      // guiState.input.architecture === "ResNet50"
      updateGuiInternalResolution(defaultResNetInternalResolution, [
        'low',
        'medium',
        'high',
        'full'
      ]);
      updateGuiOutputStride(defaultResNetStride, [32, 16]);
      updateGuiMultiplier(defaultResNetMultiplier, [1.0]);
    }
    updateGuiQuantBytes(defaultQuantBytes, [1, 2, 4]);
  }

  // Architecture: there are a few PoseNet models varying in size and
  // accuracy. 1.01 is the largest, but will be the slowest. 0.50 is the
  // fastest, but least accurate.
  architectureController = input.add(guiState.input, 'architecture', [
    'ResNet50',
    'MobileNetV1'
  ]);
  guiState.architecture = guiState.input.architecture;
  architectureController.onChange(function (architecture) {
    // if architecture is ResNet50, then show ResNet50 options
    state.changingArchitecture = true;
    guiState.input.architecture = architecture;
    updateGuiInputSection();
  });

  updateGuiInputSection();
  input.open();

  const estimateController = gui.add(guiState, 'estimate', 'segmentation');

  let segmentation = gui.addFolder('Segmentation');
  segmentation.add(guiState.segmentation, 'segmentationThreshold', 0.0, 1.0);
  const segmentationEffectController = segmentation.add(
    guiState.segmentation,
    'effect',
    ['bokeh', 'noBackground']
  );

  let darknessLevel;
  let bokehBlurAmount;
  let edgeBlurAmount;
  let maskBlurAmount;
  let maskBackground;

  segmentationEffectController.onChange(function (effectType) {
    if (effectType === 'noBackground') {
      if (bokehBlurAmount) {
        bokehBlurAmount.remove();
      }
      if (edgeBlurAmount) {
        edgeBlurAmount.remove();
      }
      maskBlurAmount = segmentation
        .add(guiState.segmentation, 'maskBlurAmount')
        .min(0)
        .max(20)
        .step(1);
      maskBackground = segmentation.add(
        guiState.segmentation,
        'maskBackground'
      );
    } else if (effectType === 'bokeh') {
      if (maskBlurAmount) {
        maskBlurAmount.remove();
      }
      if (maskBackground) {
        maskBackground.remove();
      }
      bokehBlurAmount = segmentation
        .add(guiState.segmentation, 'backgroundBlurAmount')
        .min(1)
        .max(20)
        .step(1);
      edgeBlurAmount = segmentation
        .add(guiState.segmentation, 'edgeBlurAmount')
        .min(0)
        .max(20)
        .step(1);
    }
  });

  // manually set the effect so that the options are shown.
  segmentationEffectController.setValue(guiState.segmentation.effect);
  segmentation.open();

  gui.add(guiState, 'showFps').onChange((showFps) => {
    if (showFps) {
      document.body.appendChild(stats.dom);
    } else {
      document.body.removeChild(stats.dom);
    }
  });
}

/**
 * Sets up a frames per second panel on the top-left of the window
 */
function setupFPS() {
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  if (guiState.showFps) {
    document.body.appendChild(stats.dom);
  }
}

async function estimateSegmentation() {
  let multiPersonSegmentation = null;
  switch (guiState.algorithm) {
    case 'multi-person-instance':
      return await state.net.segmentMultiPerson(state.video, {
        internalResolution: guiState.input.internalResolution,
        segmentationThreshold: guiState.segmentation.segmentationThreshold,
        maxDetections: guiState.multiPersonDecoding.maxDetections,
        scoreThreshold: guiState.multiPersonDecoding.scoreThreshold,
        nmsRadius: guiState.multiPersonDecoding.nmsRadius,
        numKeypointForMatching:
          guiState.multiPersonDecoding.numKeypointForMatching,
        refineSteps: guiState.multiPersonDecoding.refineSteps
      });
    case 'person':
      return await state.net.segmentPerson(state.video, {
        internalResolution: guiState.input.internalResolution,
        segmentationThreshold: guiState.segmentation.segmentationThreshold,
        maxDetections: guiState.multiPersonDecoding.maxDetections,
        scoreThreshold: guiState.multiPersonDecoding.scoreThreshold,
        nmsRadius: guiState.multiPersonDecoding.nmsRadius
      });
    default:
      break;
  }
  return multiPersonSegmentation;
}

async function loadBodyPix() {
  toggleLoadingUI(true);
  state.net = await bodyPix.load({
    architecture: guiState.input.architecture,
    outputStride: guiState.input.outputStride,
    multiplier: guiState.input.multiplier,
    quantBytes: guiState.input.quantBytes
  });
  toggleLoadingUI(false);
}

/**
 * Feeds an image to BodyPix to estimate segmentation - this is where the
 * magic happens. This function loops with a requestAnimationFrame method.
 */
function segmentBodyInRealTime() {
  const canvas = document.getElementById('output');
  // since images are being fed from a webcam

  async function bodySegmentationFrame() {
    // if changing the model or the camera, wait a second for it to complete
    // then try again.
    if (
      state.changingArchitecture ||
      state.changingMultiplier ||
      state.changingCamera ||
      state.changingStride ||
      state.changingQuantBytes
    ) {
      console.log('load model...');
      loadBodyPix();
      state.changingArchitecture = false;
      state.changingMultiplier = false;
      state.changingStride = false;
      state.changingQuantBytes = false;
    }

    // Begin monitoring code for frames per second
    stats.begin();

    const flipHorizontally = guiState.flipHorizontal;

    switch (guiState.estimate) {
      case 'segmentation':
        const personSegmentation = await estimateSegmentation();
        let foregroundColor = { r: 255, g: 255, b: 255, a: 255 };
        let backgroundColor = { r: 0, g: 0, b: 0, a: 255 };

        const ctx = canvas.getContext('2d');

        switch (guiState.segmentation.effect) {
          case 'bokeh':
            bodyPix.drawBokehEffect(
              canvas,
              state.video,
              personSegmentation,
              +guiState.segmentation.backgroundBlurAmount,
              guiState.segmentation.edgeBlurAmount,
              flipHorizontally
            );
            break;
          case 'noBackground':
            // Convert the segmentation into a mask to darken the background.
            foregroundColor = { r: 255, g: 255, b: 255, a: 255 };
            backgroundColor = { r: 0, g: 0, b: 0, a: 0 };

            // For a picture background.
            const backgroundDarkeningMask = bodyPix.toMask(
              personSegmentation,
              foregroundColor,
              backgroundColor,
              false
            );
            // composite the segmentation mask on top
            ctx.globalCompositeOperation = 'destination-over';
            ctx.putImageData(backgroundDarkeningMask, 0, 0);
            // composite the video frame
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(
              state.video,
              0,
              0,
              state.video.videoWidth,
              state.video.videoHeight
            );
            break;
        }
        break;
      default:
        break;
    }

    // End monitoring code for frames per second
    stats.end();
    requestAnimationFrame(bodySegmentationFrame);
  }
  bodySegmentationFrame();
}

/**
 * Kicks off the demo.
 */
export async function bindPage() {
  // Load the BodyPix model weights with architecture 0.75
  await loadBodyPix();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main').style.display = 'inline-block';

  await loadVideo(guiState.camera);

  let cameras = await getVideoInputs();

  setupFPS();
  setupGui(cameras);
  segmentBodyInRealTime();
}

navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia;
// kick off the demo
bindPage();
