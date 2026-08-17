import thermal from '@ohos.thermal';

thermal.getThermalLevel();
thermal.subscribeThermalLevel(() => {});
thermal.unsubscribeThermalLevel();
