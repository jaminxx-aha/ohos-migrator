import wifiext from '@ohos.wifiext';

wifiext.PowerModel;
wifiext.PowerModel.GENERAL;
wifiext.PowerModel.SLEEPING;
wifiext.PowerModel.THROUGH_WALL;
wifiext.disableHotspot();
wifiext.enableHotspot();
wifiext.getPowerModel();
wifiext.getSupportedPowerModel();
wifiext.setPowerModel(wifiext.PowerModel.SLEEPING);
