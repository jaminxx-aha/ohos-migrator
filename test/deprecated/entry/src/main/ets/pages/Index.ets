@Entry
@Component
struct Index {
  @State message: string = 'Spike';
  build() {
    Column() {
      Text(this.message).fontSize(50)
    }.width('100%').height('100%')
  }
}
