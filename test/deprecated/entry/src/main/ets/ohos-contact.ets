import contact from '@ohos.contact';

// Build a realistic contact record from real attribute objects.
function buildContact(): contact.Contact {
  const c = new contact.Contact();
  const name = new contact.Name();
  name.fullName = 'Alice Zhang';
  name.familyName = 'Zhang';
  name.givenName = 'Alice';
  c.name = name;
  const phone = new contact.PhoneNumber();
  phone.phoneNumber = '13800138000';
  phone.labelName = 'mobile';
  c.phoneNumbers = [phone];
  const email = new contact.Email();
  email.email = 'alice@example.com';
  email.labelName = 'home';
  c.emails = [email];
  return c;
}

// Scenario A: create a contact, then update its name.
async function addAndUpdateContact(): Promise<void> {
  const c = buildContact();
  const id = await new Promise<number>((resolve, reject) => {
    contact.addContact(c, (err, data) => { if (err) reject(err); else resolve(data); });
  });
  const name = c.name;
  if (name) name.familyName = 'Zhang-Updated';
  await new Promise<void>((resolve, reject) => {
    contact.updateContact(c, (err) => { if (err) reject(err); else resolve(); });
  });
  console.info('contact added/updated, id =', id);
}

// Scenario B: look up contacts by phone number and by email.
async function lookupByPhoneAndEmail(): Promise<void> {
  const byPhone = await new Promise<contact.Contact[]>((resolve, reject) => {
    contact.queryContactsByPhoneNumber('13800138000', (err, data) => { if (err) reject(err); else resolve(data); });
  });
  const byEmail = await new Promise<contact.Contact[]>((resolve, reject) => {
    contact.queryContactsByEmail('alice@example.com', (err, data) => { if (err) reject(err); else resolve(data); });
  });
  console.info('found', byPhone.length, byEmail.length, 'contacts');
}

// Scenario C: browse the full address book, groups, holders, and my card.
async function browseAddressBook(): Promise<void> {
  const all = await new Promise<contact.Contact[]>((resolve, reject) => {
    contact.queryContacts((err, data) => { if (err) reject(err); else resolve(data); });
  });
  const groups = await new Promise<contact.Group[]>((resolve, reject) => {
    contact.queryGroups((err, data) => { if (err) reject(err); else resolve(data); });
  });
  const holders = await new Promise<contact.Holder[]>((resolve, reject) => {
    contact.queryHolders((err, data) => { if (err) reject(err); else resolve(data); });
  });
  const myCard = await new Promise<contact.Contact>((resolve, reject) => {
    contact.queryMyCard((err, data) => { if (err) reject(err); else resolve(data); });
  });
  const picked = await new Promise<contact.Contact[]>((resolve, reject) => {
    contact.selectContact((err, data) => { if (err) reject(err); else resolve(data); });
  });
  console.info('book:', all.length, groups.length, holders.length, !!myCard, picked.length);
}

// Scenario D: inspect a single contact by key, resolve its id, and check membership flags.
async function inspectContact(): Promise<void> {
  const target = await new Promise<contact.Contact>((resolve, reject) => {
    contact.queryContact('1', (err, data) => { if (err) reject(err); else resolve(data); });
  });
  const id = target.id ?? 1;
  const key = await new Promise<string>((resolve, reject) => {
    contact.queryKey(id, (err, data) => { if (err) reject(err); else resolve(data); });
  });
  const isLocal = await new Promise<boolean>((resolve, reject) => {
    contact.isLocalContact(id, (err, data) => { if (err) reject(err); else resolve(data); });
  });
  const isMine = await new Promise<boolean>((resolve, reject) => {
    contact.isMyCard(id, (err, data) => { if (err) reject(err); else resolve(data); });
  });
  console.info('inspected', key, isLocal, isMine);
}

// Scenario E: remove a contact by its unique key.
async function removeContact(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    contact.deleteContact('1', (err) => { if (err) reject(err); else resolve(); });
  });
  console.info('contact removed');
}

async function run(): Promise<void> {
  try {
    await addAndUpdateContact();
    await lookupByPhoneAndEmail();
    await browseAddressBook();
    await inspectContact();
    await removeContact();
  } catch (e) {
    console.error('contact scenario failed', e);
  }
}

run();
