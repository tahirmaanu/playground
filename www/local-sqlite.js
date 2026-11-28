(function () {
  'use strict';

  const DATABASE = 'patient_management_android';
  const VERSION = 1;
  const PATIENT_FIELDS = [
    'recordNumber', 'date', 'newVisit', 'patientName', 'age', 'phone', 'address',
    'checkupFee', 'paidAmount', 'disease', 'symptoms', 'pulse', 'hijama',
    'prescription', 'perhaiz'
  ];
  const TEXT_FIELDS = [
    'date', 'newVisit', 'patientName', 'age', 'phone', 'address', 'disease',
    'symptoms', 'pulse', 'hijama', 'prescription'
  ];
  const DATABASE_ACTIONS = new Set([
    'list', 'get', 'search', 'save', 'delete', 'bulk_save',
    'get_settings', 'set_whatsapp_auto_open', 'export_backup',
    'restore_backup', 'truncate_all'
  ]);

  let sqlite = null;
  let initialization = null;

  function plugin() {
    if (sqlite) return sqlite;
    const registered = window.Capacitor?.Plugins?.CapacitorSQLite;

    if (!registered) {
      throw new Error(
        'CapacitorSQLite native plugin is not available in this Android app.'
      );
    }

    sqlite = registered;
    return sqlite;
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      const db = plugin();
      const consistency = await db.checkConnectionsConsistency({
        dbNames: [DATABASE],
        openModes: ['RW']
      });
      if (!consistency.result) {
        await db.createConnection({
          database: DATABASE,
          encrypted: false,
          mode: 'no-encryption',
          version: VERSION,
          readonly: false
        });
      }
      const open = await db.isDBOpen({ database: DATABASE, readonly: false });
      if (!open.result) await db.open({ database: DATABASE, readonly: false });
      await db.execute({
        database: DATABASE,
        transaction: false,
        statements: `
          CREATE TABLE IF NOT EXISTS records (
            entryId INTEGER PRIMARY KEY AUTOINCREMENT,
            recordNumber TEXT NOT NULL UNIQUE,
            date TEXT,
            newVisit TEXT,
            patientName TEXT NOT NULL,
            age TEXT,
            phone TEXT NOT NULL,
            address TEXT,
            checkupFee TEXT NOT NULL DEFAULT '0',
            paidAmount TEXT NOT NULL DEFAULT '0',
            disease TEXT,
            symptoms TEXT,
            pulse TEXT,
            prescription TEXT,
            hijama TEXT,
            perhaiz TEXT NOT NULL DEFAULT '[]'
          );
          CREATE TABLE IF NOT EXISTS app_settings (
            settingKey TEXT PRIMARY KEY,
            settingValue TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_records_recordNumber ON records(recordNumber);
          CREATE INDEX IF NOT EXISTS idx_records_patientName ON records(patientName);
          CREATE INDEX IF NOT EXISTS idx_records_phone ON records(phone);
          CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
        `
      });
      return db;
    })().catch(error => {
      initialization = null;
      throw error;
    });
    return initialization;
  }

  async function query(statement, values = []) {
    const db = await initialize();
    const result = await db.query({ database: DATABASE, statement, values });
    return Array.isArray(result.values) ? result.values : [];
  }

  async function run(statement, values = [], transaction = true) {
    const db = await initialize();
    return db.run({ database: DATABASE, statement, values, transaction });
  }

  async function inTransaction(callback) {
    const db = await initialize();
    let active = false;
    try {
      await db.beginTransaction({ database: DATABASE });
      active = true;
      const result = await callback();
      await db.commitTransaction({ database: DATABASE });
      active = false;
      return result;
    } catch (error) {
      if (active) {
        try {
          const state = await db.isTransactionActive({ database: DATABASE });
          if (state.result) await db.rollbackTransaction({ database: DATABASE });
        } catch (rollbackError) {
          console.error('SQLite rollback failed:', rollbackError);
        }
      }
      throw error;
    }
  }

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function cleanAmount(value) {
    const text = String(value ?? '').replace(/[^0-9.-]/g, '');
    const number = Number(text);
    return Number.isFinite(number) && text !== '' ? String(number) : '0';
  }

  function cleanPerhaiz(value) {
    if (!Array.isArray(value)) return '[]';
    const selected = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const text = item.trim();
      if (text && !selected.includes(text)) selected.push(text);
    }
    return JSON.stringify(selected);
  }

  function recordFromRow(row) {
    let perhaiz = [];
    try {
      const decoded = JSON.parse(String(row.perhaiz ?? '[]'));
      if (Array.isArray(decoded)) perhaiz = decoded.filter(item => typeof item === 'string');
    } catch (_) {}
    return {
      entryId: String(row.entryId ?? ''),
      recordNumber: String(row.recordNumber ?? ''),
      date: String(row.date ?? ''),
      newVisit: String(row.newVisit ?? ''),
      patientName: String(row.patientName ?? ''),
      age: String(row.age ?? ''),
      phone: String(row.phone ?? ''),
      address: String(row.address ?? ''),
      checkupFee: String(row.checkupFee ?? '0'),
      paidAmount: String(row.paidAmount ?? '0'),
      disease: String(row.disease ?? ''),
      symptoms: String(row.symptoms ?? ''),
      pulse: String(row.pulse ?? ''),
      hijama: String(row.hijama ?? ''),
      prescription: String(row.prescription ?? ''),
      perhaiz
    };
  }

  async function allRecords() {
    const rows = await query('SELECT * FROM records ORDER BY date ASC, recordNumber ASC, entryId ASC');
    return rows.map(recordFromRow);
  }

  async function allocateRecordNumber() {
    const rows = await query("SELECT MAX(CAST(recordNumber AS INTEGER)) AS highest FROM records WHERE recordNumber <> '' AND recordNumber NOT GLOB '*[^0-9]*'");
    return String(Math.max(4999, Number(rows[0]?.highest ?? 0)) + 1);
  }

  function valuesFor(record) {
    const values = {};
    for (const field of TEXT_FIELDS) values[field] = cleanText(record[field]);
    values.checkupFee = cleanAmount(record.checkupFee ?? '0');
    values.paidAmount = cleanAmount(record.paidAmount ?? '0');
    values.perhaiz = cleanPerhaiz(record.perhaiz);
    return values;
  }

  async function saveRecord(record, requireExisting = false, allowProvidedNumber = false) {
    const values = valuesFor(record);
    const id = cleanText(record.entryId);
    if (!values.patientName || !values.phone) {
      throw new Error('Missing required patient fields: patientName and phone.');
    }

    if (id && !/^\d+$/.test(id)) throw new Error('Invalid patient record ID for update.');
    if (id) {
      const found = await query('SELECT recordNumber FROM records WHERE entryId = ?', [Number(id)]);
      if (found.length) {
        const updates = PATIENT_FIELDS.filter(field => field !== 'recordNumber' && Object.prototype.hasOwnProperty.call(record, field));
        if (updates.length) {
          const assignments = updates.map(field => `${field} = ?`).join(', ');
          const updateValues = updates.map(field => field === 'perhaiz' ? values.perhaiz : values[field]);
          await run(`UPDATE records SET ${assignments} WHERE entryId = ?`, [...updateValues, Number(id)], false);
        }
        return String(found[0].recordNumber);
      }
    }
    if (requireExisting && id) throw new Error('Patient record to update was not found.');

    const requestedNumber = allowProvidedNumber ? cleanText(record.recordNumber) : '';
    values.recordNumber = requestedNumber || await allocateRecordNumber();
    const columns = ['recordNumber', ...Object.keys(values)];
    const insertValues = [values.recordNumber, ...Object.values(values)];
    await run(`INSERT INTO records (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, insertValues, false);
    return values.recordNumber;
  }

  async function backupData() {
    const settings = await query('SELECT settingKey, settingValue FROM app_settings ORDER BY settingKey');
    return {
      format: 'patient-management-local-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      records: await allRecords(),
      settings
    };
  }

  function validateBackup(data) {
    if (!data || data.format !== 'patient-management-local-backup' || data.version !== 1 ||
        !Array.isArray(data.records) || !Array.isArray(data.settings)) {
      throw new Error('The selected file is not a supported Patient Record backup.');
    }
    for (const record of data.records) {
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
          !cleanText(record.recordNumber) || !cleanText(record.patientName) || !cleanText(record.phone)) {
        throw new Error('The backup contains an invalid patient record.');
      }
      if (record.perhaiz !== undefined && (!Array.isArray(record.perhaiz) || record.perhaiz.some(item => typeof item !== 'string'))) {
        throw new Error('The backup contains invalid Perhaiz data.');
      }
    }
    for (const setting of data.settings) {
      if (!setting || typeof setting.settingKey !== 'string' || typeof setting.settingValue !== 'string') {
        throw new Error('The backup contains an invalid application setting.');
      }
    }
  }

  async function saveSafetyBackup(data, purpose) {
    const storage = window.Capacitor?.Plugins?.PatientFileStorage;
    if (!storage?.saveSafetyBackup) throw new Error('Android backup storage is unavailable.');
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    return storage.saveSafetyBackup({
      fileName: `patient-record-${purpose}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      data: encoded
    });
  }

  async function importBackup(data) {
    validateBackup(data);
    const safety = await saveSafetyBackup(await backupData(), 'safety-before-restore');
    const result = await inTransaction(async () => {
      let imported = 0;
      let duplicates = 0;
      for (const source of data.records) {
        const values = valuesFor(source);
        const fields = ['recordNumber', ...TEXT_FIELDS, 'checkupFee', 'paidAmount', 'perhaiz', 'hijama'];
        const valuesByField = { ...values, recordNumber: cleanText(source.recordNumber), hijama: cleanText(source.hijama) };
        const placeholders = fields.map(() => '?').join(', ');
        const insert = await run(`INSERT OR IGNORE INTO records (${fields.join(', ')}) VALUES (${placeholders})`, fields.map(field => valuesByField[field] ?? ''), false);
        if (Number(insert?.changes?.changes ?? insert?.changes ?? 0) > 0) imported++;
        else duplicates++;
      }
      for (const setting of data.settings) {
        await run('INSERT OR IGNORE INTO app_settings (settingKey, settingValue) VALUES (?, ?)', [setting.settingKey, setting.settingValue], false);
      }
      const count = await query('SELECT COUNT(*) AS total FROM records');
      return { totalBackupRecords: data.records.length, duplicatesSkipped: duplicates, newRecordsImported: imported, finalPatientRecordCount: Number(count[0]?.total ?? 0) };
    });
    return { ...result, safetyBackup: safety?.fileName || '' };
  }

  async function truncateAll() {
    const safety = await saveSafetyBackup(await backupData(), 'safety-before-truncate');
    const deleted = await inTransaction(async () => {
      const count = await query('SELECT COUNT(*) AS total FROM records');
      await run('DELETE FROM records', [], false);
      return Number(count[0]?.total ?? 0);
    });
    return { deletedPatientRecords: deleted, remainingPatientRecords: 0, backupLocation: safety?.fileName || '' };
  }

  async function request(action, payload = {}) {
    await initialize();
    if (!DATABASE_ACTIONS.has(action)) throw new Error(`Unsupported local database action: ${action}`);

    if (action === 'list') return { ok: true, records: await allRecords() };
    if (action === 'get') {
      const id = cleanText(payload.entryId);
      if (!/^\d+$/.test(id)) throw new Error('A valid entryId is required.');
      const rows = await query('SELECT * FROM records WHERE entryId = ?', [Number(id)]);
      if (!rows.length) throw new Error('Patient record not found.');
      return { ok: true, record: recordFromRow(rows[0]) };
    }
    if (action === 'search') {
      const search = cleanText(payload.query);
      if (!search) return { ok: true, records: [] };
      const like = `%${search}%`;
      const rows = await query('SELECT * FROM records WHERE recordNumber LIKE ? OR patientName LIKE ? OR phone LIKE ? ORDER BY date ASC, recordNumber ASC, entryId ASC', [like, like, like]);
      return { ok: true, records: rows.map(recordFromRow) };
    }
    if (action === 'save') {
      const record = payload.record && typeof payload.record === 'object' ? payload.record : {};
      if (!cleanText(record.patientName) || !cleanText(record.phone)) throw new Error('Missing required patient field.');
      const number = await inTransaction(async () => saveRecord(record, Boolean(cleanText(record.entryId)), false));
      record.recordNumber = number;
      return { ok: true, recordNumber: number, records: await allRecords() };
    }
    if (action === 'bulk_save') {
      if (!Array.isArray(payload.records)) throw new Error('Invalid records payload.');
      await inTransaction(async () => {
        for (const record of payload.records) {
          if (record && typeof record === 'object') await saveRecord(record, false, true);
        }
      });
      return { ok: true, records: await allRecords() };
    }
    if (action === 'delete') {
      const id = cleanText(payload.entryId);
      if (!/^\d+$/.test(id)) throw new Error('entryId is required.');
      await run('DELETE FROM records WHERE entryId = ?', [Number(id)]);
      return { ok: true, records: await allRecords() };
    }
    if (action === 'get_settings') {
      const rows = await query('SELECT settingValue FROM app_settings WHERE settingKey = ?', ['whatsapp_auto_open']);
      return { ok: true, whatsappAutoOpen: rows[0]?.settingValue === '1' };
    }
    if (action === 'set_whatsapp_auto_open') {
      if (typeof payload.enabled !== 'boolean') throw new Error('A boolean enabled value is required.');
      await run('INSERT INTO app_settings (settingKey, settingValue) VALUES (?, ?) ON CONFLICT(settingKey) DO UPDATE SET settingValue = excluded.settingValue', ['whatsapp_auto_open', payload.enabled ? '1' : '0']);
      return { ok: true, whatsappAutoOpen: payload.enabled };
    }
    if (action === 'export_backup') return { ok: true, backup: await backupData() };
    if (action === 'restore_backup') {
      const result = await importBackup(payload.backup);
      return { ok: true, ...result, records: await allRecords() };
    }
    if (action === 'truncate_all') {
      if (payload.confirmation !== 'DELETE_ALL_PATIENT_RECORDS') throw new Error('Explicit confirmation is required.');
      const result = await truncateAll();
      return { ok: true, ...result, records: await allRecords() };
    }
    throw new Error(`Unsupported local database action: ${action}`);
  }

  window.PatientLocalDb = {
    supports: action => DATABASE_ACTIONS.has(action),
    request
  };
})();
