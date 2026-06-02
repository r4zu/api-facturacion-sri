const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

let clientConfig;

// 1. Intentar usar la variable unificada DATABASE_URL
if (process.env.DATABASE_URL) {
  console.log('📝 Usando variable DATABASE_URL para la conexión.');
  clientConfig = { connectionString: process.env.DATABASE_URL };
} 
// 2. Si no existe, usar las variables individuales que tiene tu contenedor
else if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
  console.log('📝 Usando variables individuales (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) para la conexión.');
  clientConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
} 
// 3. Si no hay ninguna, arrojar error
else {
  console.error('❌ Error: No se encontraron variables de entorno para conectar a la base de datos (DATABASE_URL o DB_HOST/DB_USER/DB_PASSWORD/DB_NAME).');
  process.exit(1);
}

const sqlFilePath = path.join(__dirname, 'init.sql');

if (!fs.existsSync(sqlFilePath)) {
  console.error(`❌ Error: No se encontró el archivo init.sql en la ruta: ${sqlFilePath}`);
  process.exit(1);
}

console.log('🔄 Leyendo archivo init.sql...');
const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

console.log('🔌 Conectando a la base de datos PostgreSQL...');
const client = new Client(clientConfig);

async function run() {
  try {
    await client.connect();
    console.log('✅ Conexión establecida con éxito.');

    console.log('⏳ Ejecutando init.sql (esto puede tomar unos segundos)...');
    await client.query(sqlContent);
    console.log('🎉 ¡Base de datos inicializada exitosamente! Se crearon todas las tablas y catálogos.');
  } catch (error) {
    console.error('❌ Error al ejecutar el script de base de datos:', error);
  } finally {
    await client.end();
  }
}

run();
