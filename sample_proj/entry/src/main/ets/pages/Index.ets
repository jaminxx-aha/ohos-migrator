import dataUriUtils from '@ohos.app.ability.dataUriUtils';
import rdb from '@ohos.data.relationalStore';
import prompt from '@ohos.promptAction';
import reminderAgent from '@ohos.reminderAgent';
import abilityDataUriUtils from '@ohos.app.ability.dataUriUtils';

@Entry
@Component
struct Index {
  @State msg: string = 'hi';
  build() {
    Column() {
      Text(this.msg)
    }
    .onClick(() => {
      const id = dataUriUtils.getId('x');
      rdb.getRdbStore(null as any);
      prompt.showToast({ message: 'done' });
      reminderAgent.publishReminder(null as any);
      abilityDataUriUtils.getId('y');
    });
  }
}
