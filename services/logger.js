function ts() {
  return new Date().toISOString();
}

function info(message, meta) {
  if (meta !== undefined) console.log(`[${ts()}] [INFO] ${message}`, meta);
  else console.log(`[${ts()}] [INFO] ${message}`);
}

function warn(message, meta) {
  if (meta !== undefined) console.warn(`[${ts()}] [WARN] ${message}`, meta);
  else console.warn(`[${ts()}] [WARN] ${message}`);
}

function error(message, err) {
  console.error(`[${ts()}] [ERROR] ${message}`);
  if (err && err.stack) console.error(err.stack);
  else if (err) console.error(err);
}

module.exports = { info, warn, error };
