'use strict';

/** IUPAC 1–118 원소 기호 (검증용). */
const RAW = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
  'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
  'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
  'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
  'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
];

const SYMBOL_SET = new Set(RAW);

/** @param {string} raw */
function normalizeElementSymbol(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t.length === 1) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** @param {string} sym */
function isValidElementSymbol(sym) {
  return SYMBOL_SET.has(normalizeElementSymbol(sym));
}

const ATOMIC_NUMBER_BY_SYMBOL = new Map();
RAW.forEach((sym, idx) => {
  ATOMIC_NUMBER_BY_SYMBOL.set(sym, idx + 1);
});

/** @param {string} sym normalized symbol */
function getAtomicNumberForSymbol(sym) {
  const s = normalizeElementSymbol(sym);
  if (!s) return undefined;
  const z = ATOMIC_NUMBER_BY_SYMBOL.get(s);
  return typeof z === 'number' ? z : undefined;
}

module.exports = {
  PERIODIC_ELEMENT_SYMBOLS: RAW,
  SYMBOL_SET,
  normalizeElementSymbol,
  isValidElementSymbol,
  getAtomicNumberForSymbol,
};
