'use strict';

/**
 * Singleplay-Game5 `game.js` 와 동일한 키워드 매칭 (재료 이름에 need 토큰이 포함되는지).
 * @param {{ id: string, name: string }[]} mats
 */
function keywordsMatchRecipe(need, mats) {
  if (need.length !== mats.length) return false;
  const used = new Set();
  for (let k = 0; k < need.length; k += 1) {
    const kw = need[k];
    let found = -1;
    for (let i = 0; i < mats.length; i += 1) {
      if (used.has(i)) continue;
      if (String(mats[i].name).includes(kw)) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    used.add(found);
  }
  return true;
}

function subsetMatchesNeed(need, subset) {
  if (need.length !== subset.length) return false;
  const k = subset.length;
  if (k <= 1) return keywordsMatchRecipe(need, subset);

  const idx = Array.from({ length: k }, (_, i) => i);
  function permute(depth) {
    if (depth === k) {
      const order = idx.map((j) => subset[j]);
      return keywordsMatchRecipe(need, order);
    }
    for (let i = depth; i < k; i += 1) {
      [idx[depth], idx[i]] = [idx[i], idx[depth]];
      if (permute(depth + 1)) return true;
      [idx[depth], idx[i]] = [idx[i], idx[depth]];
    }
    return false;
  }
  return permute(0);
}

function firstMatchingSubset(need, mats) {
  const k = need.length;
  const n = mats.length;
  if (k === 0 || n < k) return null;

  if (k === 1) {
    for (let i = 0; i < n; i += 1) {
      const one = [mats[i]];
      if (subsetMatchesNeed(need, one)) return one;
    }
    return null;
  }
  if (k === 2) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const pair = [mats[i], mats[j]];
        if (subsetMatchesNeed(need, pair)) return pair;
      }
    }
    return null;
  }
  if (k === 3) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        for (let t = j + 1; t < n; t += 1) {
          const tri = [mats[i], mats[j], mats[t]];
          if (subsetMatchesNeed(need, tri)) return tri;
        }
      }
    }
    return null;
  }

  function comb(start, acc) {
    if (acc.length === k) {
      return subsetMatchesNeed(need, acc) ? acc.slice() : null;
    }
    for (let i = start; i < n; i += 1) {
      acc.push(mats[i]);
      const hit = comb(i + 1, acc);
      acc.pop();
      if (hit) return hit;
    }
    return null;
  }
  return comb(0, []);
}

/**
 * @param {{ id: string, need: string[], out: object }} rec
 * @param {{ id: string, name: string }[]} mats
 * @returns {{ id: string, name: string }[] | null}
 */
function matchingSubsetForRecipe(rec, mats) {
  if (!rec || !rec.need || rec.need.length === 0) return null;
  if (mats.length < rec.need.length) return null;
  return firstMatchingSubset(rec.need, mats);
}

module.exports = {
  keywordsMatchRecipe,
  subsetMatchesNeed,
  firstMatchingSubset,
  matchingSubsetForRecipe,
};
