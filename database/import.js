const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Use DATABASE_URL from environment variables
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ Error: La variable de entorno DATABASE_URL no está definida.');
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
const client = new Client({
  connectionString: connectionString,
});

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
