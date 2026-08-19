import Vector from '@ohos.util.Vector';

// Scenario: manage a small in-memory queue of task identifiers using a Vector.

async function buildTaskQueue(): Promise<Vector<string>> {
  const queue: Vector<string> = new Vector<string>();

  // Seed the queue with a realistic task id.
  const added: boolean = queue.add('task:render-frame');
  console.info('seeded queue, added=' + added);

  // Insert a high-priority task at the front.
  queue.insert('task:handle-input', 0);

  // Replace an existing task id at a known index with a refined one.
  const replaced: string = queue.set(1, 'task:render-frame-hires');

  // Grow capacity ahead of a bulk insert.
  queue.increaseCapacityTo(32);
  const capacity: number = queue.getCapacity();
  console.info('capacity after grow=' + capacity);

  // Duplicate the queue so we can iterate without mutating the live one.
  const snapshot: Vector<string> = queue.clone();

  // Lookups.
  const len: number = queue.length;
  const first: string = queue.getFirstElement();
  const last: string = queue.getLastElement();
  const atIdx: string = queue.get(0);
  const containsFlush: boolean = queue.has('task:render-frame-hires');
  const firstIdx: number = queue.getIndexOf('task:render-frame-hires');
  const firstIdxFrom: number = queue.getIndexFrom('task:render-frame-hires', 0);
  const lastIdx: number = queue.getLastIndexOf('task:render-frame-hires');
  const lastIdxFrom: number = queue.getLastIndexFrom('task:render-frame-hires', len - 1);
  console.info('len=' + len + ' first=' + first + ' last=' + last + ' at0=' + atIdx +
    ' hasRefined=' + containsFlush + ' firstIdx=' + firstIdx +
    ' firstIdxFrom=' + firstIdxFrom + ' lastIdx=' + lastIdx +
    ' lastIdxFrom=' + lastIdxFrom);

  // Iterate the snapshot.
  snapshot.forEach((value: string, index?: number) => {
    console.info('snapshot[' + index + ']=' + value);
  });

  // Export forms.
  const asArray: string[] = queue.convertToArray();
  const sink: string[] = new Array<string>(len);
  queue.copyToArray(sink);
  console.info('asArray.len=' + asArray.length + ' sink.len=' + sink.length);
  console.info('toString=' + queue.toString());

  // Sorting and slicing.
  queue.sort((a: string, b: string) => a.localeCompare(b));
  const windowView: Vector<string> = queue.subVector(0, len);
  console.info('subVector present');

  // Emptiness check.
  const empty: boolean = queue.isEmpty();
  console.info('empty=' + empty);

  // Removals.
  const removedByValue: boolean = queue.remove('task:render-frame-hires');
  const removedByIndex: string = queue.removeByIndex(0);
  queue.removeByRange(0, 1);
  console.info('removedByValue=' + removedByValue + ' removedByIndex=' + removedByIndex);

  // Reset to a small length and trim capacity to match.
  queue.setLength(2);
  queue.trimToCurrentLength();
  console.info('finalized');

  // Clear the snapshot clone.
  snapshot.clear();

  return queue;
}

async function run(): Promise<void> {
  try {
    await buildTaskQueue();
  } catch (e) {
    console.error('queue build failed', e);
  }
}

run();
