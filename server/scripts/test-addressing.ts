// Who a group message is for, with phrases from real chats. No model. Usage: npx tsx scripts/test-addressing.ts
import { calledByName, directedAtOther, firstNames } from '../src/connections/addressing.js';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };
const A = ['Gael', 'Autoafiliacion', 'Morena'];
// called
for (const t of ['Gael acaba de desplegar la rama de pruebas para la pwa en nacional e internacional, verdad Gael?', 'te presento a un amigo, Gael saluda a Fer por favor c:', 'Gael, qué hora es', 'hola Gael', 'oye Gael ¿me ayudas?', 'gracias Gael', 'Entonces, Gael, qué opinas', 'Autoafiliacion ayúdame con esto', '¿Gael estás ahí?', 'ok gael', 'Hey Gael dime algo']) eq(`called: "${t.slice(0, 55)}"`, calledByName(A, t), true);
// not called: the name is a noun inside a sentence about something else
for (const t of ['Queríamos saber Fer si nos puedes ayudar con unas pruebas por favor de esas ramas en AutoAfiliacion por favor c:', 'El proyecto Gael va muy bien', 'Subí la rama de Autoafiliacion', 'las pruebas de Morena salieron bien', 'Hola Fernando como estas amigo soy Hugo c:', 'Claro, en el nacional o internacional?']) eq(`not called: "${t.slice(0, 55)}"`, calledByName(A, t), false);
// directed at somebody else in the chat
const people = firstNames(['Fernando Merino', 'Hugo', 'c0mrade10'], ['Hugo']);   // the humans of the chat, without the sender
eq('people exclude the sender and keep first names', people.includes('Fernando') && !people.includes('Hugo'), true);
for (const t of ['Fer, le agregue estas características', 'Hola Fernando como estas amigo', 'El internacional por favor Fernando c:', 'Fernando, ¿puedes probar?', 'Queríamos saber Fer si nos puedes ayudar con unas pruebas', 'oye Fer mira esto']) eq(`for Fer: "${t.slice(0, 55)}"`, directedAtOther(people, t) !== null, true);
for (const t of ['Gael acaba de desplegar la rama, verdad Gael?', 'Qué hora es', 'Las pruebas de la rama salieron bien', 'Claro, en el nacional o internacional?', 'El deploy de la rama quedó arriba']) eq(`not for Fer: "${t.slice(0, 55)}"`, directedAtOther(people, t), null);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
