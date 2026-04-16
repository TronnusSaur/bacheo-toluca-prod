# Guía Técnica: Seguridad y Roles en Bacheo Toluca

Esta guía explica la arquitectura de seguridad implementada para soportar múltiples frentes de trabajo con aislamiento de datos.

## 1. Arquitectura de Usuarios (RBAC)

El sistema ahora utiliza un modelo de **Control de Acceso Basado en Roles (RBAC)** gestionado desde Postgres.

### Tabla `app_users`
- **Email:** Identificador único (Firebase Auth).
- **Role:** 
  - `ADMIN`: Visión global y edición total.
  - `SUPERVISOR`: Puede gestionar múltiples contratos asignados.
  - `RESIDENTE`: Gestión exclusiva de un solo contrato.
- **Assigned Contracts:** Array de IDs (ej. `["Contrato 001", "Contrato 002"]`).

## 2. Flujo de Autenticación y Filtros

Cada vez que la App solicita datos:
1. El Cliente envía un **Firebase ID Token**.
2. El Servidor verifica el token y busca al usuario en Postgres (`app_users`).
3. Si el usuario es un Supervisor o Residente, las consultas SQL se filtran automáticamente:
   ```sql
   SELECT * FROM reports WHERE contractId = ANY($1)
   ```
4. El catálogo de contratos se limpia para mostrar solo las opciones permitidas al usuario.

## 3. Trazabilidad y Auditoría

Para cumplir con los requisitos de auditoría, cada acción deja rastro:

| Acción | Registro en Postgres | Registro en Google Sheets |
| :--- | :--- | :--- |
| **Crear Reporte** | Columna `created_by` | Columna **T** (Responsable) |
| **Subir Foto Caja/Final** | Columna `updated_by` | Columna **T** (Se sobreescribe con el último editor) |
| **Cambio de Estatus** | Columna `updated_by` | Columna **T** |

## 4. Google Sheets (Estructura)

La estructura del Master Sheet se ha expandido a **20 columnas (A a T)**.
- **Columna T:** Contiene el correo electrónico del usuario responsable de la última acción.

## 5. Gestión de Nuevos Usuarios

Para dar de alta a los 48 residentes:
1. El usuario debe crear su cuenta en la App (Firebase Auth).
2. Se debe insertar su permiso en Postgres:
   ```sql
   INSERT INTO app_users (email, role, assigned_contracts)
   VALUES ('usuario@ejemplo.mx', 'RESIDENTE', '{"Contrato 001"}');
   ```

---
*Nota: Esta configuración asegura que ningún contratista pueda acceder a datos de la competencia, incluso si intentan manipular la API directamente.*
