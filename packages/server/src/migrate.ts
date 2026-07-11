import { createPool, migrate } from './db.js';

const db = createPool(
  process.env.DATABASE_URL ?? 'postgres://effigent:effigent@localhost:5433/effigent',
);
migrate(db)
  .then(() => {
    console.log('migrations applied');
    return db.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
