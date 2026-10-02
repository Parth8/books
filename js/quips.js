// Little lines that make the app feel like it knows you. All of them work with or without a
// name. Nothing here is ever sent anywhere.

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const N = (name) => (name ? name : "you");
const Nc = (name) => (name ? name : "friend");

export function greeting(name, hour = new Date().getHours()) {
  const n = Nc(name);
  if (hour < 4) return pick([`Still up, ${n}? Same.`, `${n}, it's late. One more chapter.`, `Night owl ${n} has entered the chat.`]);
  if (hour < 12) return pick([`Morning, ${n} ☀️`, `Coffee and a chapter, ${n}?`, `Rise and read, ${n}.`]);
  if (hour < 17) return pick([`Afternoon, ${n}.`, `Lunch break chapter, ${n}?`, `Hey ${n}. The books missed you.`]);
  if (hour < 21) return pick([`Evening, ${n} 🌆`, `Golden-hour reading, ${n}?`, `Welcome back, ${n}.`]);
  return pick([`One more chapter, ${n}? 🌙`, `Bedtime story, ${n}?`, `Late shift, ${n}. Respect.`]);
}

export function pages(name, n) {
  return pick([
    `${n} pages. The plot thickens, ${N(name)}.`,
    `Pages fear ${N(name)}.`,
    `${N(name)}: ${n} pages closer to the twist.`,
    "Main character energy.",
    "That's the stuff.",
    "Brain: moisturised.",
    `Somewhere a librarian just smiled.`,
  ]);
}

export function finished(name) {
  return pick([`Another one bites the dust, ${Nc(name)}.`, `${Nc(name)}, you absolute page-turner.`, "Closing a book is a kind of magic.", "Book: defeated.", "Shelf just got heavier."]);
}

export function added(name) {
  return pick(["Fresh stamp, just licked.", `Good pick, ${Nc(name)}.`, "Into the pile it goes.", "Tsundoku level: rising.", "The shelf approves."]);
}

export function combo(name, n) {
  return pick([`×${n}! ${Nc(name)} is cooking.`, `×${n} combo. Unstoppable.`, `×${n}. Who let ${N(name)} cook?`]);
}

export function goodbyeNoName() {
  return pick(["Mysterious. We like it.", "A reader of few words.", "Fine, Anonymous Reader it is."]);
}

export function hello(name) {
  return pick([`Nice to meet you, ${name}.`, `${name}! Great name. Very bookish.`, `Welcome aboard, ${name}.`, `${name}, your shelves await.`]);
}
