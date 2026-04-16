/**
 * manage-users.js
 * Script de utilidad para asignar ROLES y CONTRATOS a los usuarios.
 * 
 * Uso: 
 * node manage-users.js <email> <role> <contractIds...>
 * 
 * Ejemplos:
 * node manage-users.js residente@test.com RESIDENTE "Contrato 001"
 * node manage-users.js supervisor@test.com SUPERVISOR "Contrato 001" "Contrato 002"
 */

import pool from './api/lib/db.js';

const [,, email, role, ...contracts] = process.argv;

if (!email || !role) {
  console.log('Uso: node manage-users.js <email> <role> <contractIds...>');
  console.log('Roles: ADMIN, SUPERVISOR, RESIDENTE');
  process.exit(1);
}

async function manageUser() {
  try {
    const query = `
      INSERT INTO app_users (email, role, assigned_contracts)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE 
      SET role = EXCLUDED.role, assigned_contracts = EXCLUDED.assigned_contracts;
    `;
    
    await pool.query(query, [email, role.toUpperCase(), contracts]);
    
    console.log(`\n✅ Usuario actualizado correctamente:`);
    console.log(`- Email: ${email}`);
    console.log(`- Rol: ${role.toUpperCase()}`);
    console.log(`- Contratos: ${contracts.join(', ') || 'TODOS (Admin)'}`);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error gestionando usuario:', err.message);
    process.exit(1);
  }
}

manageUser();
