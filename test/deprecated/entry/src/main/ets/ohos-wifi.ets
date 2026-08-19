import wifi from '@ohos.wifi';

// Scenario 1: monitor STA-side Wi-Fi state, signal level, feature support.
async function monitorStaState(): Promise<void> {
  const stateListener = (state: number): void => {
    console.info('wifiStateChange state=' + state);
  };
  wifi.on('wifiStateChange', stateListener);
  try {
    const active: boolean = wifi.isWifiActive();
    if (!active) {
      console.info('wifi inactive, skipping sta probe');
      return;
    }
    const connected: boolean = wifi.isConnected();
    const country: string = wifi.getCountryCode();
    const supported: boolean = wifi.isFeatureSupported(0);
    const rssi: number = -55;
    const level: number = wifi.getSignalLevel(rssi, 4);
    console.info(`active=${active} connected=${connected} country=${country} level=${level} feature=${supported}`);
  } catch (e) {
    console.error('monitorStaState failed', e);
  } finally {
    wifi.off('wifiStateChange', stateListener);
  }
}

// Scenario 2: scan, parse results, add/remove an untrusted config, read link & IP info.
async function scanAndInspect(): Promise<void> {
  try {
    const started: boolean = wifi.scan();
    if (!started) {
      console.info('scan request rejected');
      return;
    }
    const scanInfos: Array<wifi.WifiScanInfo> = await wifi.getScanInfos();
    for (const ap of scanInfos) {
      const info: wifi.WifiScanInfo = ap;
      const ssid: string = info.ssid;
      const bssid: string = info.bssid;
      const capabilities: string = info.capabilities;
      const rssi: number = info.rssi;
      const band: number = info.band;
      const frequency: number = info.frequency;
      const channelWidth: number = info.channelWidth;
      const securityType: wifi.WifiSecurityType = info.securityType;
      const timestamp: number = info.timestamp;
      console.info(`AP ${ssid} ${bssid} rssi=${rssi} freq=${frequency} band=${band} cw=${channelWidth} sec=${securityType} ts=${timestamp} caps=${capabilities}`);
    }

    const pskConfig: wifi.WifiDeviceConfig = {
      ssid: 'HomeNet',
      bssid: 'aa:bb:cc:dd:ee:ff',
      preSharedKey: 'correcthorsebattery',
      isHiddenSsid: false,
      securityType: wifi.WifiSecurityType.WIFI_SEC_TYPE_PSK
    };
    const openConfig: wifi.WifiDeviceConfig = {
      ssid: 'Guest', bssid: '', preSharedKey: '', isHiddenSsid: false,
      securityType: wifi.WifiSecurityType.WIFI_SEC_TYPE_OPEN
    };
    const saeConfig: wifi.WifiDeviceConfig = {
      ssid: 'SAEHotspot', bssid: '', preSharedKey: 'saePassphrase', isHiddenSsid: true,
      securityType: wifi.WifiSecurityType.WIFI_SEC_TYPE_SAE
    };
    const wepConfig: wifi.WifiDeviceConfig = {
      ssid: 'WEPNet', bssid: '', preSharedKey: 'wepkey123', isHiddenSsid: false,
      securityType: wifi.WifiSecurityType.WIFI_SEC_TYPE_WEP
    };
    const invalidConfig: wifi.WifiDeviceConfig = {
      ssid: '', bssid: '', preSharedKey: '', isHiddenSsid: false,
      securityType: wifi.WifiSecurityType.WIFI_SEC_TYPE_INVALID
    };
    void openConfig; void saeConfig; void wepConfig; void invalidConfig;

    const cfgSsid: string = pskConfig.ssid;
    const cfgBssid: string = pskConfig.bssid;
    const cfgKey: string = pskConfig.preSharedKey;
    const cfgHidden: boolean = pskConfig.isHiddenSsid;
    const cfgSec: wifi.WifiSecurityType = pskConfig.securityType;
    console.info(`config ${cfgSsid} ${cfgBssid} key=${cfgKey} hidden=${cfgHidden} sec=${cfgSec}`);

    const added: boolean = await wifi.addUntrustedConfig(pskConfig);
    console.info('addUntrustedConfig=' + added);

    const linked: wifi.WifiLinkedInfo = await wifi.getLinkedInfo();
    const lSsid: string = linked.ssid;
    const lBssid: string = linked.bssid;
    const lRssi: number = linked.rssi;
    const lBand: number = linked.band;
    const linkSpeed: number = linked.linkSpeed;
    const lFrequency: number = linked.frequency;
    const isHidden: boolean = linked.isHidden;
    const isRestricted: boolean = linked.isRestricted;
    const macAddress: string = linked.macAddress;
    const ipAddress: number = linked.ipAddress;
    const connState: wifi.ConnState = linked.connState;
    console.info(`linked ${lSsid} ${lBssid} rssi=${lRssi} band=${lBand} speed=${linkSpeed} mac=${macAddress} ip=${ipAddress} hidden=${isHidden} restricted=${isRestricted}`);
    switch (connState) {
      case wifi.ConnState.SCANNING:
        console.info('state=SCANNING');
        break;
      case wifi.ConnState.CONNECTING:
        console.info('state=CONNECTING');
        break;
      case wifi.ConnState.AUTHENTICATING:
        console.info('state=AUTHENTICATING');
        break;
      case wifi.ConnState.OBTAINING_IPADDR:
        console.info('state=OBTAINING_IPADDR');
        break;
      case wifi.ConnState.CONNECTED:
        console.info('state=CONNECTED');
        break;
      case wifi.ConnState.DISCONNECTING:
        console.info('state=DISCONNECTING');
        break;
      case wifi.ConnState.DISCONNECTED:
        console.info('state=DISCONNECTED');
        break;
      case wifi.ConnState.UNKNOWN:
        console.info('state=UNKNOWN');
        break;
    }

    const ip: wifi.IpInfo = wifi.getIpInfo();
    const ipAddr: number = ip.ipAddress;
    const netmask: number = ip.netmask;
    const gateway: number = ip.gateway;
    const primaryDns: number = ip.primaryDns;
    const secondDns: number = ip.secondDns;
    const serverIp: number = ip.serverIp;
    const leaseDuration: number = ip.leaseDuration;
    console.info(`ip=${ipAddr} mask=${netmask} gw=${gateway} dns1=${primaryDns} dns2=${secondDns} dhcp=${serverIp} lease=${leaseDuration}`);

    const removed: boolean = await wifi.removeUntrustedConfig(pskConfig);
    console.info('removeUntrustedConfig=' + removed);
  } catch (e) {
    console.error('scanAndInspect failed', e);
  }
}

// Scenario 3: P2P discovery, connect to a peer, manage group lifecycle.
async function p2pLifecycle(): Promise<void> {
  try {
    const discovering: boolean = wifi.startDiscoverDevices();
    if (!discovering) {
      console.info('p2p discovery already running or unsupported');
    }
    const peers: Array<wifi.WifiP2pDevice> = await wifi.getP2pPeerDevices();
    for (const p of peers) {
      const peer: wifi.WifiP2pDevice = p;
      const deviceAddress: string = peer.deviceAddress;
      const deviceName: string = peer.deviceName;
      const primaryDeviceType: string = peer.primaryDeviceType;
      const deviceStatus: wifi.P2pDeviceStatus = peer.deviceStatus;
      const groupCapabilitys: number = peer.groupCapabilitys;
      console.info(`peer ${deviceName} addr=${deviceAddress} type=${primaryDeviceType} caps=${groupCapabilitys} status=${deviceStatus}`);
      switch (deviceStatus) {
        case wifi.P2pDeviceStatus.CONNECTED:
          break;
        case wifi.P2pDeviceStatus.INVITED:
          break;
        case wifi.P2pDeviceStatus.FAILED:
          break;
        case wifi.P2pDeviceStatus.AVAILABLE:
          break;
        case wifi.P2pDeviceStatus.UNAVAILABLE:
          break;
      }
    }

    const targetAddr: string = peers.length > 0 ? peers[0].deviceAddress : '00:11:22:33:44:55';
    const connectCfg: wifi.WifiP2PConfig = {
      deviceAddress: targetAddr,
      netId: -1,
      passphrase: 'p2pPassphrase',
      groupName: 'DirectLinkGroup',
      goBand: wifi.GroupOwnerBand.GO_BAND_AUTO
    };
    const connectOk: boolean = wifi.p2pConnect(connectCfg);
    console.info('p2pConnect=' + connectOk);

    const cfgAddr: string = connectCfg.deviceAddress;
    const cfgNetId: number = connectCfg.netId;
    const cfgPass: string = connectCfg.passphrase;
    const cfgGName: string = connectCfg.groupName;
    const cfgGoBand: wifi.GroupOwnerBand = connectCfg.goBand;
    console.info(`p2pConfig addr=${cfgAddr} netId=${cfgNetId} group=${cfgGName} band=${cfgGoBand} pass=${cfgPass}`);

    const supportedBands: number[] = [
      wifi.GroupOwnerBand.GO_BAND_2GHZ,
      wifi.GroupOwnerBand.GO_BAND_5GHZ
    ];
    const groupCfg: wifi.WifiP2PConfig = {
      deviceAddress: targetAddr,
      netId: -2,
      passphrase: 'groupOwnerKey',
      groupName: 'PersistentP2pGroup',
      goBand: supportedBands[0]
    };
    const groupOk: boolean = wifi.createGroup(groupCfg);
    console.info('createGroup=' + groupOk);

    const group: wifi.WifiP2pGroupInfo = await wifi.getCurrentGroup();
    const groupName: string = group.groupName;
    const passphrase: string = group.passphrase;
    const interfaceName: string = group.interface;
    const isP2pGo: boolean = group.isP2pGo;
    const networkId: number = group.networkId;
    const frequency: number = group.frequency;
    const goIpAddress: string = group.goIpAddress;
    const clientDevices: Array<wifi.WifiP2pDevice> = group.clientDevices;
    const ownerInfo: wifi.WifiP2pDevice = group.ownerInfo;
    console.info(`group ${groupName} iface=${interfaceName} go=${isP2pGo} netId=${networkId} freq=${frequency} goIp=${goIpAddress} clients=${clientDevices.length} owner=${ownerInfo.deviceName}`);

    const p2pLinked: wifi.WifiP2pLinkedInfo = await wifi.getP2pLinkedInfo();
    const p2pConnectState: wifi.P2pConnectState = p2pLinked.connectState;
    const isGroupOwner: boolean = p2pLinked.isGroupOwner;
    const groupOwnerAddr: string = p2pLinked.groupOwnerAddr;
    switch (p2pConnectState) {
      case wifi.P2pConnectState.CONNECTED:
        console.info(`p2p connected go=${isGroupOwner} goAddr=${groupOwnerAddr}`);
        break;
      case wifi.P2pConnectState.DISCONNECTED:
        console.info('p2p disconnected');
        break;
    }

    wifi.p2pCancelConnect();
    wifi.removeGroup();
    wifi.stopDiscoverDevices();
  } catch (e) {
    console.error('p2pLifecycle failed', e);
  }
}

async function run(): Promise<void> {
  await monitorStaState();
  await scanAndInspect();
  await p2pLifecycle();
}

run();
