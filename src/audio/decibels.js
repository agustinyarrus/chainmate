/**
 * Decibels — the conversions between a level in dB and a linear gain, in the two precisions the
 * original uses them: GDScript's (double) and the audio server's (single). One module, because the
 * mixer, the engine and the tests must agree on every bit of them.
 *
 * The exponential here is the runtime's: rounded to single precision it agrees with the original's
 * unless the exact value lies within a billionth of a rounding boundary.
 */

const F = Math.fround;

/** ln(10) / 20 and 20 / ln(10), as the engine spells them. */
const DB_TO_LINEAR = 0.11512925464970228420089957273422;
const LINEAR_TO_DB = 8.6858896380650365530225783783321;
const DB_TO_LINEAR_F = F(DB_TO_LINEAR);

/** GDScript db_to_linear(db). */
export const dbToLinear = (db) => Math.exp(db * DB_TO_LINEAR);

/** GDScript linear_to_db(linear). */
export const linearToDb = (linear) => Math.log(linear) * LINEAR_TO_DB;

/** Math::db_to_linear(float): what a player or a bus turns its volume_db into. */
export function dbToLinearF(db) {
  return F(Math.exp(F(F(db) * DB_TO_LINEAR_F)));
}

/**
 * A gain (0‥1) as the volume of a player, the way Sfx._set_music_gain sets it: floored, stored as
 * single-precision decibels, converted back by the player.
 */
export function gainToVolume(gain, floor) {
  return dbToLinearF(F(linearToDb(Math.max(gain, floor))));
}
