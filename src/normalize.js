// Normalizacija srpskih naziva: ćirilica → latinica, bez kvačica, mala slova.

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
};
const LAT = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj' };

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (ch) => CYR[ch] ?? ch)
    .replace(/[čćšžđ]/g, (ch) => LAT[ch])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stemWord(word) {
  return word.length > 3 ? word.replace(/[aeiou]$/, '') : word;
}

export function nameKey(text) {
  const n = normalize(text);
  return n ? n.split(' ').map(stemWord).join(' ') : '';
}
