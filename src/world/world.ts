/**
 * The world the rocket flies in. All units SI (metres, kilograms, seconds, pascals).
 * Edit these numbers to change the environment. Wind is a placeholder for later.
 */
export interface World {
  gravity: number;        // m/s^2, positive number pulling down (-Y)
  airDensity: number;     // kg/m^3 at sea level
  waterDensity: number;   // kg/m^3
  atmosphericPressure: number; // Pa
  wind: [number, number, number]; // m/s, world-space vector (not used yet)
}

export const earth: World = {
  gravity: 9.81,
  airDensity: 1.225,
  waterDensity: 1000,
  atmosphericPressure: 101_325,
  wind: [0, 0, 0],
};
