import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

// Pull every deprecated-API usage corpus file into the compile graph.
import '../corpus-index';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'corpus', '%{public}s', 'Ability onCreate');
  }
  onDestroy(): void {}
  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) { hilog.error(0x0000, 'corpus', 'load failed'); }
    });
  }
  onWindowStageDestroy(): void {}
  onForeground(): void {}
  onBackground(): void {}
}
