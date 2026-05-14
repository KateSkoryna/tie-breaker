import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
console.log(Object.keys(firebaseRulesPlugin));
if (firebaseRulesPlugin.parsers) {
  console.log('parsers:', Object.keys(firebaseRulesPlugin.parsers));
} else {
  console.log('parsers is undefined');
}
