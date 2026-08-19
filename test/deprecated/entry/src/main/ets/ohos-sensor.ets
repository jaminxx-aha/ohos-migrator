import sensor from '@ohos.sensor';

// Scenario 1: subscribe to motion/orientation sensors for a fitness tracking session.
function subscribeMotionSensors(): void {
  try {
    const opts: sensor.Options = { interval: 100000000 };
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_ACCELEROMETER, (data) => {
      console.info('accel x=' + data.x + ' y=' + data.y + ' z=' + data.z);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_GYROSCOPE, (data) => {
      console.info('gyro x=' + data.x + ' y=' + data.y + ' z=' + data.z);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_LINEAR_ACCELERATION, (data) => {
      console.info('linearAccel x=' + data.x + ' y=' + data.y + ' z=' + data.z);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_GRAVITY, (data) => {
      console.info('gravity x=' + data.x + ' y=' + data.y + ' z=' + data.z);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_MAGNETIC_FIELD, (data) => {
      console.info('mag x=' + data.x + ' y=' + data.y + ' z=' + data.z);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_ROTATION_VECTOR, (data) => {
      console.info('rot x=' + data.x + ' y=' + data.y + ' z=' + data.z + ' w=' + data.w);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_SIGNIFICANT_MOTION, (data) => {
      console.info('significantMotion value=' + data.scalar);
    });
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_ORIENTATION, (data) => {
      console.info('orientation alpha=' + data.alpha + ' beta=' + data.beta + ' gamma=' + data.gamma);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_PEDOMETER, (data) => {
      console.info('pedometer steps=' + data.steps);
    }, opts);
    sensor.on(sensor.SensorType.SENSOR_TYPE_ID_PEDOMETER_DETECTION, (data) => {
      console.info('pedometerDetection value=' + data.scalar);
    });
  } catch (e) {
    console.error('subscribeMotionSensors failed', e);
  }
}

// Scenario 2: one-shot sampling of environmental / on-body sensors.
function sampleEnvironmentOnce(): void {
  try {
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_AMBIENT_LIGHT, (data) => {
      console.info('light level=' + data.intensity + ' lux');
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_AMBIENT_TEMPERATURE, (data) => {
      console.info('ambient temp=' + data.temperature + ' C');
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_HUMIDITY, (data) => {
      console.info('humidity=' + data.humidity + ' %');
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_BAROMETER, (data) => {
      console.info('pressure=' + data.pressure + ' Pa');
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_PROXIMITY, (data) => {
      console.info('proximity distance=' + data.distance);
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_HALL, (data) => {
      console.info('hall value=' + data.status);
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_HEART_RATE, (data) => {
      console.info('heartRate bpm=' + data.heartRate);
    });
    sensor.once(sensor.SensorType.SENSOR_TYPE_ID_WEAR_DETECTION, (data) => {
      console.info('wear value=' + data.value);
    });
  } catch (e) {
    console.error('sampleEnvironmentOnce failed', e);
  }
}

// Scenario 3: best-effort teardown of any leftover uncalibrated sensor subscriptions.
function unsubscribeUncalibratedSensors(): void {
  try {
    sensor.off(sensor.SensorType.SENSOR_TYPE_ID_ACCELEROMETER_UNCALIBRATED);
    sensor.off(sensor.SensorType.SENSOR_TYPE_ID_GYROSCOPE_UNCALIBRATED);
    sensor.off(sensor.SensorType.SENSOR_TYPE_ID_MAGNETIC_FIELD_UNCALIBRATED);
  } catch (e) {
    console.error('unsubscribeUncalibratedSensors failed', e);
  }
}

// Scenario 4: compute device orientation / altitude pipeline from raw sensor vectors.
async function computeOrientationPipeline(): Promise<void> {
  const rotationVector: number[] = [0.12, 0.35, -0.18, 0.91];
  try {
    const rotationMatrix: number[] = await sensor.createRotationMatrix(rotationVector);
    const quaternion: number[] = await sensor.createQuaternion(rotationVector);
    const direction: number[] = await sensor.getDirection(rotationMatrix);
    const dip: number = await sensor.getGeomagneticDip(rotationMatrix);
    const prevMatrix: number[] = rotationMatrix.map((v) => v * 0.5);
    const angleModify: number[] = await sensor.getAngleModify(rotationMatrix, prevMatrix);
    const transformed: number[] = await sensor.transformCoordinateSystem(rotationMatrix, { x: 2, y: 1 });
    console.info('orientation zxy=' + direction.join(',') + ' dip=' + dip +
      ' angleModify=' + angleModify.join(',') + ' quaternion=' + quaternion.join(',') +
      ' transformed=' + transformed.join(','));

    const seaPressure = 1013.25;
    const currentPressure = 1008.4;
    const altitude: number = await sensor.getAltitude(seaPressure, currentPressure);
    console.info('device altitude=' + altitude + ' m');

    const geoField = await sensor.getGeomagneticField(
      { latitude: 31.2304, longitude: 121.4737, altitude: 4.0 },
      Date.now(),
    );
    console.info('geomagnetic x=' + geoField.x + ' y=' + geoField.y + ' z=' + geoField.z +
      ' declination=' + geoField.geomagneticDip);
  } catch (e) {
    console.error('computeOrientationPipeline failed', e);
  }
}

async function run(): Promise<void> {
  subscribeMotionSensors();
  sampleEnvironmentOnce();
  unsubscribeUncalibratedSensors();
  await computeOrientationPipeline();
}

run();
