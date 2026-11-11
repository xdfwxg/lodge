# fullstack-settings

A settings page with two independent halves:

- `frontend/app.js`: form defaults, payload shaping and validation.
- `backend/store.js` + `backend/server.js`: settings store and HTTP handler.

Each half has its own tests, and the shared payload shape is covered by the
integration test. Changes to the form and the API can be made in parallel.
Tests run with `npm test`.
