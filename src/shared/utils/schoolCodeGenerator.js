export function generateSchoolCode(name, city, serialNumber) {
  const prefix = name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);

  const cityCode = city ? city.slice(0, 2).toUpperCase() : 'XX';

  const year = new Date().getFullYear();
  const seq = String(serialNumber).padStart(4, '0');

  return `${prefix}-${cityCode}-${year}-${seq}`;
}
