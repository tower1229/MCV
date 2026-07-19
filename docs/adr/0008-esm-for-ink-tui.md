# Adopt ESM for the Ink TUI

MCV will migrate the entire package from CommonJS to NodeNext/ESM before introducing Ink 7. The existing Node `>=22.12.0` runtime floor already satisfies Ink 7, and a single ESM build avoids the long-term packaging and test complexity of a CommonJS core plus an ESM-only TUI bridge; the migration must land and pass the existing CLI, typecheck, test, build, and npm bin checks as an independent change before TUI work begins.
