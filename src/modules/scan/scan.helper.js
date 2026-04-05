export const maskPhone = phone => {
  if (!phone) return null;

  const cleaned = phone.replace(/\D/g, '');
  const len = cleaned.length;

  if (len < 6) return '****';

  if (len <= 10) {
    return cleaned.slice(0, 2) + '****' + cleaned.slice(-2);
  }

  return cleaned.slice(0, 3) + '****' + cleaned.slice(-3);
};
