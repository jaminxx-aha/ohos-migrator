import Sensor from '@system.sensor';
import { AccelerometerResponse, BarometerResponse, CompassResponse, DeviceOrientationResponse, GetOnBodyStateOptions, GyroscopeResponse, HeartRateResponse, LightResponse, OnBodyStateResponse, ProximityResponse, StepCounterResponse, SubscribeBarometerOptions, SubscribeCompassOptions, SubscribeDeviceOrientationOptions, SubscribeGyroscopeOptions, SubscribeHeartRateOptions, SubscribeLightOptions, SubscribeOnBodyStateOptions, SubscribeProximityOptions, SubscribeStepCounterOptions, subscribeAccelerometerOptions } from '@system.sensor';

function logConfig(name: string, interval: string | undefined, hasSuccess: boolean, hasFail: boolean): void {
  console.info(name, 'interval=', interval, 'success=', hasSuccess, 'fail=', hasFail);
}

// Motion tracking: accelerometer, gyroscope, device orientation.
async function monitorMotion(): Promise<void> {
  const accelOpts: subscribeAccelerometerOptions = {
    interval: 'game',
    success: (data: AccelerometerResponse) => {
      const ax: number = data.x;
      const ay: number = data.y;
      const az: number = data.z;
      console.info('accel', ax, ay, az);
    },
    fail: (data: string, code: number) => {
      console.error('accel fail', data, code);
    },
  };
  logConfig('accel', accelOpts.interval, accelOpts.success != null, accelOpts.fail != null);
  Sensor.subscribeAccelerometer(accelOpts);

  const gyroOpts: SubscribeGyroscopeOptions = {
    interval: 'normal',
    success: (data: GyroscopeResponse) => {
      const gx: number = data.x;
      const gy: number = data.y;
      const gz: number = data.z;
      console.info('gyro', gx, gy, gz);
    },
    fail: (data: string, code: number) => {
      console.error('gyro fail', data, code);
    },
  };
  logConfig('gyro', gyroOpts.interval, gyroOpts.success != null, gyroOpts.fail != null);
  Sensor.subscribeGyroscope(gyroOpts);

  const orientOpts: SubscribeDeviceOrientationOptions = {
    interval: 'normal',
    success: (data: DeviceOrientationResponse) => {
      const alpha: number = data.alpha;
      const beta: number = data.beta;
      const gamma: number = data.gamma;
      console.info('orientation', alpha, beta, gamma);
    },
    fail: (data: string, code: number) => {
      console.error('orientation fail', data, code);
    },
  };
  logConfig('orient', orientOpts.interval, orientOpts.success != null, orientOpts.fail != null);
  Sensor.subscribeDeviceOrientation(orientOpts);
}

// Environmental sensors: barometer, compass, light, proximity.
async function monitorEnvironment(): Promise<void> {
  const barOpts: SubscribeBarometerOptions = {
    success: (data: BarometerResponse) => {
      const pressure: number = data.pressure;
      console.info('pressure', pressure);
    },
    fail: (data: string, code: number) => {
      console.error('barometer fail', data, code);
    },
  };
  logConfig('bar', undefined, barOpts.success != null, barOpts.fail != null);
  Sensor.subscribeBarometer(barOpts);

  const compassOpts: SubscribeCompassOptions = {
    success: (data: CompassResponse) => {
      const direction: number = data.direction;
      console.info('direction', direction);
    },
    fail: (data: string, code: number) => {
      console.error('compass fail', data, code);
    },
  };
  logConfig('compass', undefined, compassOpts.success != null, compassOpts.fail != null);
  Sensor.subscribeCompass(compassOpts);

  const lightOpts: SubscribeLightOptions = {
    success: (data: LightResponse) => {
      const intensity: number = data.intensity;
      console.info('intensity', intensity);
    },
    fail: (data: string, code: number) => {
      console.error('light fail', data, code);
    },
  };
  logConfig('light', undefined, lightOpts.success != null, lightOpts.fail != null);
  Sensor.subscribeLight(lightOpts);

  const proxOpts: SubscribeProximityOptions = {
    success: (data: ProximityResponse) => {
      const distance: number = data.distance;
      console.info('distance', distance);
    },
    fail: (data: string, code: number) => {
      console.error('proximity fail', data, code);
    },
  };
  logConfig('prox', undefined, proxOpts.success != null, proxOpts.fail != null);
  Sensor.subscribeProximity(proxOpts);
}

// Health sensors: heart rate, step counter, on-body state.
async function monitorHealth(): Promise<void> {
  const hrOpts: SubscribeHeartRateOptions = {
    success: (data: HeartRateResponse) => {
      const heartRate: number = data.heartRate;
      console.info('heartRate', heartRate);
    },
    fail: (data: string, code: number) => {
      console.error('heartRate fail', data, code);
    },
  };
  logConfig('hr', undefined, hrOpts.success != null, hrOpts.fail != null);
  Sensor.subscribeHeartRate(hrOpts);

  const stepOpts: SubscribeStepCounterOptions = {
    success: (data: StepCounterResponse) => {
      const steps: number = data.steps;
      console.info('steps', steps);
    },
    fail: (data: string, code: number) => {
      console.error('step fail', data, code);
    },
  };
  logConfig('step', undefined, stepOpts.success != null, stepOpts.fail != null);
  Sensor.subscribeStepCounter(stepOpts);

  const bodyOpts: SubscribeOnBodyStateOptions = {
    success: (data: OnBodyStateResponse) => {
      console.info('onBody change received', JSON.stringify(data));
    },
    fail: (data: string, code: number) => {
      console.error('onBody fail', data, code);
    },
  };
  logConfig('onBody', undefined, bodyOpts.success != null, bodyOpts.fail != null);
  Sensor.subscribeOnBodyState(bodyOpts);

  // One-shot query for current on-body state.
  const getOpts: GetOnBodyStateOptions = {
    success: (data: OnBodyStateResponse) => {
      console.info('onBodyState query', data.value);
    },
    fail: (data: string, code: number) => {
      console.error('onBodyState query fail', data, code);
    },
    complete: () => {
      console.info('onBodyState query complete');
    },
  };
  logConfig('getOnBody', undefined, getOpts.success != null, getOpts.fail != null);
  const completeCb = getOpts.complete;
  if (completeCb) { completeCb(); }
  Sensor.getOnBodyState(getOpts);
}

async function run(): Promise<void> {
  try {
    await monitorMotion();
    await monitorEnvironment();
    await monitorHealth();

    // Tear down all subscriptions after a sample window.
    Sensor.unsubscribeAccelerometer();
    Sensor.unsubscribeGyroscope();
    Sensor.unsubscribeDeviceOrientation();
    Sensor.unsubscribeBarometer();
    Sensor.unsubscribeCompass();
    Sensor.unsubscribeLight();
    Sensor.unsubscribeProximity();
    Sensor.unsubscribeHeartRate();
    Sensor.unsubscribeStepCounter();
    Sensor.unsubscribeOnBodyState();
  } catch (e) {
    console.error('sensor monitoring error', e);
  }
}

run();
