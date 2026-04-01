const config = {
  adminToken: process.env.ADMIN_TOKEN || 'admin_token_change_me',
  secretKey: process.env.SECRET_KEY || 'secret_key_change_me',
  databaseUrl: process.env.DATABASE_URL || './ouroboros.db',
  eventName: process.env.EVENT_NAME || 'Feira da Troca',
  maxComandas: parseInt(process.env.MAX_COMANDAS || '1000', 10),
  port: parseInt(process.env.PORT || '8000', 10),
};

module.exports = config;
