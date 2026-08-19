import rpc from '@ohos.rpc';

// A small Sequenceable payload exchanged over IPC.
class DemoPayload implements rpc.Sequenceable {
  id: number = 0;
  name: string = '';

  marshalling(dataOut: rpc.MessageParcel): boolean {
    dataOut.writeInt(this.id);
    dataOut.writeString(this.name);
    return true;
  }

  unmarshalling(dataIn: rpc.MessageParcel): boolean {
    this.id = dataIn.readInt();
    this.name = dataIn.readString();
    return true;
  }
}

// A server-side stub: subclasses RemoteObject and handles requests.
class DemoService extends rpc.RemoteObject {
  constructor() {
    super('ohos.rpc.IDemoService');
  }
}

// A client-side proxy: subclasses RemoteProxy to talk to the stub.
class DemoProxy extends rpc.RemoteProxy {
  constructor(remote: rpc.IRemoteObject) {
    super();
  }
}

const deathRecipient: rpc.DeathRecipient = {
  onRemoteDied(): void {
    console.error('remote object died');
  }
};

// Exercises the Ashmem shared-memory APIs as an IPC buffer would.
async function exerciseAshmem(): Promise<void> {
  try {
    const ash = rpc.Ashmem.createAshmem('ipc-shared-buf', 256);
    ash.mapAshmem(rpc.Ashmem.PROT_READ | rpc.Ashmem.PROT_WRITE);
    ash.setProtection(rpc.Ashmem.PROT_READ | rpc.Ashmem.PROT_WRITE);
    ash.writeAshmem([72, 101, 108, 108, 111], 5, 0);
    const written = ash.readAshmem(5, 0);

    const ash2 = rpc.Ashmem.createAshmemFromExisting(ash);
    ash2.mapReadAndWriteAshmem();
    ash2.writeToAshmem([33, 34, 35, 36], 4, 0);
    const read = ash2.readFromAshmem(4, 0);
    ash2.mapReadOnlyAshmem();
  } catch (e) {
    console.error('ashmem round trip failed', e);
  }
}

// Drives every deprecated MessageParcel read/write plus static fd helpers.
async function exerciseMessageParcel(ro: rpc.IRemoteObject, ash: rpc.Ashmem): Promise<void> {
  const data = rpc.MessageParcel.create();
  try {
    data.writeInterfaceToken('ohos.rpc.IDemoService');
    data.writeInt(1001);
    data.writeLong(9_000_000_000);
    data.writeShort(32000);
    data.writeByte(0xAB);
    data.writeChar(0x41);
    data.writeBoolean(true);
    data.writeFloat(1.25);
    data.writeDouble(3.14159265);
    data.writeString('ping');
    data.writeIntArray([1, 2, 3]);
    data.writeLongArray([10, 20, 30]);
    data.writeShortArray([100, 200]);
    data.writeByteArray([0xDE, 0xAD]);
    data.writeCharArray([0x41, 0x42]);
    data.writeBooleanArray([true, false, true]);
    data.writeFloatArray([0.5, 1.5]);
    data.writeDoubleArray([1.25, 2.5]);
    data.writeStringArray(['alpha', 'beta']);
    data.writeRemoteObject(ro);
    data.writeRemoteObjectArray([ro]);
    data.writeAshmem(ash);
    const payload = new DemoPayload();
    data.writeSequenceable(payload);
    data.writeSequenceableArray([payload]);
    data.writeFileDescriptor(1);
    data.writeRawData([0x01, 0x02, 0x03, 0x04], 4);
    data.writeNoException();

    const writePos = data.getWritePosition();
    const writable = data.getWritableBytes();
    const cap = data.getCapacity();
    const rawCap = data.getRawDataCapacity();
    const sz = data.getSize();

    data.rewindRead(0);
    const token = data.readInterfaceToken();
    const code = data.readInt();
    const longVal = data.readLong();
    const shortVal = data.readShort();
    const byteVal = data.readByte();
    const charVal = data.readChar();
    const boolVal = data.readBoolean();
    const floatVal = data.readFloat();
    const doubleVal = data.readDouble();
    const strVal = data.readString();
    const ints: number[] = []; data.readIntArray(ints);
    const longs: number[] = []; data.readLongArray(longs);
    const shorts: number[] = []; data.readShortArray(shorts);
    const bytes: number[] = []; data.readByteArray(bytes);
    const chars: number[] = []; data.readCharArray(chars);
    const bools: boolean[] = []; data.readBooleanArray(bools);
    const floats: number[] = []; data.readFloatArray(floats);
    const doubles: number[] = []; data.readDoubleArray(doubles);
    const strs: string[] = []; data.readStringArray(strs);
    const remote = data.readRemoteObject();
    const remotes: rpc.IRemoteObject[] = []; data.readRemoteObjectArray(remotes);
    const ashBack = data.readAshmem();
    const payloadBack = new DemoPayload();
    data.readSequenceable(payloadBack);
    const seqArr: rpc.Sequenceable[] = [new DemoPayload()];
    data.readSequenceableArray(seqArr);
    const fd = data.readFileDescriptor();
    const raw = data.readRawData(4);

    const readPos = data.getReadPosition();
    const readable = data.getReadableBytes();
    data.readException();

    data.rewindWrite(0);
    data.setCapacity(512);
    data.setSize(256);
    const hasFd = data.containFileDescriptors();

    const dup = rpc.MessageParcel.dupFileDescriptor(1);
    rpc.MessageParcel.closeFileDescriptor(dup);
    data.reclaim();
  } catch (e) {
    console.error('message parcel exercise failed', e);
    data.reclaim();
  }
}

// Drives the deprecated Sequenceable marshalling/unmarshalling contract.
async function exerciseSequenceable(): Promise<void> {
  const parcel = rpc.MessageParcel.create();
  try {
    const out: rpc.Sequenceable = new DemoPayload();
    out.marshalling(parcel);
    parcel.rewindRead(0);
    const inn: rpc.Sequenceable = new DemoPayload();
    inn.unmarshalling(parcel);
  } catch (e) {
    console.error('sequenceable exercise failed', e);
  }
  parcel.reclaim();
}

// MessageSequence (the non-deprecated type) still has deprecated raw-data helpers.
async function exerciseMessageSequenceRawData(): Promise<void> {  const seq = rpc.MessageSequence.create();
  try {
    seq.writeRawData([0x10, 0x20, 0x30], 3);
    const raw = seq.readRawData(3);
  } catch (e) {
    console.error('message sequence raw data failed', e);
  }
}

// Walks the RemoteObject / IRemoteObject / RemoteProxy lifecycle and IPC skeleton helpers.
async function exerciseRemoteObjects(): Promise<void> {
  try {
    const ro = new DemoService();

    // RemoteObject-specific deprecated members.
    const broker: rpc.IRemoteBroker = {
      asObject(): rpc.IRemoteObject {
        return ro;
      }
    };
    ro.attachLocalInterface(broker, 'ohos.rpc.IDemoService');
    const descriptor = ro.getInterfaceDescriptor();
    const local = ro.queryLocalInterface('ohos.rpc.IDemoService');
    const opts = new rpc.MessageOption(rpc.MessageOption.TF_SYNC);
    const req = rpc.MessageParcel.create();
    const rep = rpc.MessageParcel.create();
    ro.sendRequest(1, req, rep, opts);
    ro.onRemoteRequest(1, req, rep, opts);

    // IRemoteObject-typed view (exercises the base interface members).
    const iro: rpc.IRemoteObject = ro;
    iro.addDeathRecipient(deathRecipient, 0);
    iro.removeDeathRecipient(deathRecipient, 0);
    const iface = iro.getInterfaceDescriptor();
    const localIface = iro.queryLocalInterface('ohos.rpc.IDemoService');
    const sent = iro.sendRequest(1, req, rep, opts);

    // RemoteProxy (client side): same surface plus the async sendRequest result.
    const proxy = new DemoProxy(iro);
    proxy.addDeathRecipient(deathRecipient, 0);
    proxy.removeDeathRecipient(deathRecipient, 0);
    const proxyDesc = proxy.getInterfaceDescriptor();
    const proxyLocal = proxy.queryLocalInterface('ohos.rpc.IDemoService');
    proxy.sendRequest(1, req, rep, opts, (err: Error, result: rpc.SendRequestResult) => {
      const rc = result.code;
      const rd = result.data;
      const rp = result.reply;
      const ec = result.errCode;
    });

    // IPCSkeleton helpers.
    rpc.IPCSkeleton.flushCommands(iro);
    rpc.IPCSkeleton.setCallingIdentity('caller-identity');
  } catch (e) {
    console.error('remote object exercise failed', e);
  }
}

async function run(): Promise<void> {
  await exerciseAshmem();
  const ro: rpc.IRemoteObject = new DemoService();
  const ash = rpc.Ashmem.createAshmem('parcel-buf', 128);
  await exerciseMessageParcel(ro, ash);
  await exerciseSequenceable();
  await exerciseMessageSequenceRawData();
  await exerciseRemoteObjects();
}

run();
