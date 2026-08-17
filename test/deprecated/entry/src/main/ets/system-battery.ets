import Battery from '@system.battery';
import { BatteryResponse, GetStatusOptions } from '@system.battery';

let _v0: BatteryResponse;
let _v1: GetStatusOptions;
let _v2: Battery;
declare let _v3: BatteryResponse; _v3.charging;
declare let _v4: GetStatusOptions; _v4.complete;
declare let _v5: GetStatusOptions; _v5.fail;
Battery.getStatus();
declare let _v6: BatteryResponse; _v6.level;
declare let _v7: GetStatusOptions; _v7.success;
