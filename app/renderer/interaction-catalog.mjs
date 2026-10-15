// Local Oopz resources. Sound assignments confirmed using the numbered preview page.
const rows = [
  ['poop', '便便', '84e1b54d2fbf204d652f7e18dc1edf32', '6ba07295c9c17a41dd9763083296b930', '6020686512b7a69a2dfeb4b4fea84c99', 6888],
  ['tomato', '番茄', '4420b3e9fa3b3552bf95ddb9aea935ad', '14226d97c8e3638a25928a57c0a6a57c', 'b5c5b62773141a7b61473fdec09b514b', 5904],
  ['egg', '鸡蛋', 'fbd9aaaa32dc2416191c8323b36f6874', '31aa7967f05714569751ffebe448b0a6', 'd5360abfc672e4fc78aa3ad3b4ae3036', 6150],
  ['heart', '爱心', '85677ab0c2aa851c5c27706b889aa224', '263843755a4d155ee2a7b0837dcd949c', '8cd8e86da2c11d2708a14f963ed9a2d4', 6396],
  ['bomb', '炸弹', '0b57ff44f9e7492e24169cb645fda996', '4b03d5d2bd04b51660ed5db4e78b37c2', '2795a4f36b9746ca555d68bcdeb74f3d', 6930],
  ['cake', '蛋糕', 'e318ad7662fefcede2a85fac997e9efb', '6c49b3afd7758f476ac1dd3ca7e9a032', 'e68d131f1c5a51e7b0f799199c186dbd', 6930],
  ['thumb', '踩一下', '89cef5c54105b62bce051d97d81e9806', 'db728455d2e074b99fa9419161929ecb', '578a24e218b6ca448d1225822ceb103e', 6930],
  ['boxing', '拳击', '72cadf32f10b620aa6d651f2ea5b408f', 'ddc1638774aa5e7834d26086d8282759', '8b67b00efb9dc1662602f9dcca2d137b', 7227],
  ['question', '问号', '843eccf2d03c8330cf79813a11b981b1', '5a077b5714ecd2eb0f8c67a3c3401fa2', 'f4bcca813a515d955c896a01d470d3a4', 6930],
];
const asset = (hash, extension) => new URL(`./assets/interactions/${hash}.${extension}`, import.meta.url).href;
export const interactions = rows.map(([id, name, icon, animation, sound, duration]) => Object.freeze({ id, name, icon: asset(icon, 'webp'), animation: asset(animation, 'webp'), sound: asset(sound, 'wav'), duration }));
export const interactionById = new Map(interactions.map(item => [item.id, item]));
