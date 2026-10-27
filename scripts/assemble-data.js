// Build step: join the checksummed data parts into data/index-data.json and validate.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data', 'parts');
const parts = fs.readdirSync(dir).filter((f) => /^part-\d+\.txt$/.test(f)).sort();
const text = parts.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
const data = JSON.parse(text);
if (!Array.isArray(data.rows) || data.rows.length < 900) throw new Error('Dataset too small: ' + (data.rows || []).length);
fs.writeFileSync(path.join(__dirname, '..', 'data', 'index-data.json'), text);
console.log(`index-data.json assembled from ${parts.length} parts: ${data.rows.length} presentations, ${data.confs.length} conferences`);
