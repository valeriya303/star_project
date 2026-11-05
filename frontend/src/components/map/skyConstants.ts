/** Роки для стрілок власного руху (F10, UC-16) */
export const MOTION_YEARS = 10000;

/** Радіус ядра зорі (пікс.) за видимою зоряною величиною */
export const coreRadius = (vmag: number) => Math.max(0.75, 4.2 - 0.58 * vmag);
