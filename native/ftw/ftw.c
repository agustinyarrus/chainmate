/*
 * ftw — FreeType for the web: the glyph rasterizer of Godot's TextServerAdvanced, call for call.
 *
 * The module holds the same FreeType (2.14.3) and HarfBuzz (14.2.0) sources the engine ships, built
 * with the same options, and this file reproduces text_server_adv.cpp's use of them:
 *
 *   face    FT_Open_Face on memory; one face per font variation (Godot: one per FontAdvanced)
 *   size    FT_New_Size + FT_Activate_Size + FT_Request_Size(NOMINAL, size 26.6), then the variation
 *           coordinates are written again (_ensure_cache_for_size)
 *   glyph   FT_Load_Glyph with the font's hinting flags, the sub-pixel shift, then FT_Render_Glyph —
 *           or, with an outline size, FT_Stroker (radius = outline × 16 in 26.6, butt caps, round
 *           joins) and FT_Glyph_To_Bitmap (_ensure_glyph)
 *
 * Handles are small integers; results are read from the FtwGlyph record in linear memory.
 * Every function reports FreeType's own error code (0 = success), negated where a handle is returned.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_ADVANCES_H
#include FT_GLYPH_H
#include FT_MULTIPLE_MASTERS_H
#include FT_OUTLINE_H
#include FT_SIZES_H
#include FT_STROKER_H

#define EXPORT(name) __attribute__((export_name(#name))) name

/* TextServer::Hinting */
enum { FTW_HINTING_NONE = 0, FTW_HINTING_LIGHT = 1, FTW_HINTING_NORMAL = 2 };

/* Growth step of the handle tables. */
enum { FTW_TABLE_STEP = 16 };

typedef struct {
  FT_Face face;
  FT_Fixed* coords;   /* design coordinates in axis order (16.16), owned */
  FT_UInt axis_count;
  int hinting;
  int force_autohinter;
  int disable_embedded_bitmaps;
} FtwFace;

typedef struct {
  int face;           /* index into faces */
  FT_Size size;
  int outline;        /* Godot's size.y: outline size in pixels */
} FtwSize;

/* The result of ftw_render; `buffer` stays valid until the next ftw_render call. */
typedef struct {
  int32_t error;
  int32_t width;
  int32_t rows;
  int32_t left;
  int32_t top;
  int32_t pitch;
  int32_t advance_h;  /* FT_Get_Advance, 16.16 */
  int32_t advance_v;
  uint8_t* buffer;
} FtwGlyph;

static FT_Library library;
static FtwFace* faces;
static int face_count, face_capacity;
static FtwSize* sizes;
static int size_count, size_capacity;
static FtwGlyph result;
static FT_Glyph stroked; /* keeps the stroked bitmap alive until the next render */

static int grow(void** table, int* capacity, int count, size_t item) {
  if (count < *capacity) return 0;
  void* bigger = realloc(*table, (size_t)(*capacity + FTW_TABLE_STEP) * item);
  if (!bigger) return FT_Err_Out_Of_Memory;
  *table = bigger;
  *capacity += FTW_TABLE_STEP;
  return 0;
}

int EXPORT(ftw_init)(void) {
  if (library) return 0;
  return FT_Init_FreeType(&library);
}

/* (major << 16) | (minor << 8) | patch of the linked FreeType. */
int EXPORT(ftw_version)(void) {
  FT_Int major = 0, minor = 0, patch = 0;
  if (library) FT_Library_Version(library, &major, &minor, &patch);
  return (major << 16) | (minor << 8) | patch;
}

void* EXPORT(ftw_malloc)(uint32_t bytes) {
  return malloc(bytes);
}

void EXPORT(ftw_free)(void* block) {
  free(block);
}

const FtwGlyph* EXPORT(ftw_result)(void) {
  return &result;
}

/*
 * Opens a face over font data that must stay alive (and unmoved) for the life of the face.
 * `tags`/`values`: the variation overrides (axis tag → design value); other axes keep their default.
 * Returns a handle >= 1, or -(FreeType error).
 */
int EXPORT(ftw_face_open)(const uint8_t* data, uint32_t length, int hinting, int force_autohinter,
                          int disable_embedded_bitmaps, const uint32_t* tags, const double* values, int count) {
  if (!library) return -FT_Err_Invalid_Library_Handle;
  int error = grow((void**)&faces, &face_capacity, face_count, sizeof(FtwFace));
  if (error) return -error;

  FT_Open_Args args;
  memset(&args, 0, sizeof(args));
  args.flags = FT_OPEN_MEMORY;
  args.memory_base = data;
  args.memory_size = (FT_Long)length;

  FtwFace record;
  memset(&record, 0, sizeof(record));
  record.hinting = hinting;
  record.force_autohinter = force_autohinter;
  record.disable_embedded_bitmaps = disable_embedded_bitmaps;
  error = FT_Open_Face(library, &args, 0, &record.face);
  if (error) return -error;

  if (record.face->face_flags & FT_FACE_FLAG_MULTIPLE_MASTERS) {
    FT_MM_Var* master = NULL;
    error = FT_Get_MM_Var(record.face, &master);
    if (error) {
      FT_Done_Face(record.face);
      return -error;
    }
    record.axis_count = master->num_axis;
    record.coords = malloc(sizeof(FT_Fixed) * (master->num_axis ? master->num_axis : 1));
    if (!record.coords) {
      FT_Done_MM_Var(library, master);
      FT_Done_Face(record.face);
      return -FT_Err_Out_Of_Memory;
    }
    for (FT_UInt i = 0; i < master->num_axis; i++) {
      const FT_Var_Axis* axis = &master->axis[i];
      record.coords[i] = axis->def;
      for (int k = 0; k < count; k++) {
        if (tags[k] != axis->tag) continue;
        /* CLAMP(var.value * 65536.0, minimum, maximum), as the engine writes it. */
        double scaled = values[k] * 65536.0;
        if (scaled < (double)axis->minimum) scaled = (double)axis->minimum;
        if (scaled > (double)axis->maximum) scaled = (double)axis->maximum;
        record.coords[i] = (FT_Fixed)scaled;
      }
    }
    FT_Done_MM_Var(library, master);
  }
  faces[face_count] = record;
  return ++face_count;
}

/* Creates and activates the size (26.6) for a face; `outline` is the outline size in pixels or 0. */
int EXPORT(ftw_size_open)(int face_handle, int size_26_6, int outline) {
  if (face_handle < 1 || face_handle > face_count) return -FT_Err_Invalid_Face_Handle;
  int error = grow((void**)&sizes, &size_capacity, size_count, sizeof(FtwSize));
  if (error) return -error;
  FtwFace* owner = &faces[face_handle - 1];

  FtwSize record;
  record.face = face_handle - 1;
  record.outline = outline;
  error = FT_New_Size(owner->face, &record.size);
  if (error) return -error;
  FT_Activate_Size(record.size);

  double sz = (double)size_26_6 / 64.0;
  if (sz > 2048.0) sz = 2048.0;
  FT_Size_RequestRec request;
  request.type = FT_SIZE_REQUEST_TYPE_NOMINAL;
  request.width = (FT_Long)(sz * 64.0);
  request.height = (FT_Long)(sz * 64.0);
  request.horiResolution = 0;
  request.vertResolution = 0;
  error = FT_Request_Size(owner->face, &request);
  if (error) {
    FT_Done_Size(record.size);
    return -error;
  }
  if (owner->coords) {
    error = FT_Set_Var_Design_Coordinates(owner->face, owner->axis_count, owner->coords);
    if (error) {
      FT_Done_Size(record.size);
      return -error;
    }
  }
  sizes[size_count] = record;
  return ++size_count;
}

/* Scaled metrics of a size: ascender, descender, height, x_scale, y_scale, x_ppem, y_ppem (26.6 / 16.16). */
int EXPORT(ftw_size_metrics)(int size_handle, int32_t* out) {
  if (size_handle < 1 || size_handle > size_count) return FT_Err_Invalid_Size_Handle;
  const FT_Size_Metrics* m = &sizes[size_handle - 1].size->metrics;
  out[0] = (int32_t)m->ascender;
  out[1] = (int32_t)m->descender;
  out[2] = (int32_t)m->height;
  out[3] = (int32_t)m->x_scale;
  out[4] = (int32_t)m->y_scale;
  out[5] = (int32_t)m->x_ppem;
  out[6] = (int32_t)m->y_ppem;
  return 0;
}

static void reset_result(void) {
  if (stroked) {
    FT_Done_Glyph(stroked);
    stroked = NULL;
  }
  memset(&result, 0, sizeof(result));
}

static void publish(const FT_Bitmap* bitmap, int left, int top) {
  result.width = (int32_t)bitmap->width;
  result.rows = (int32_t)bitmap->rows;
  result.pitch = bitmap->pitch;
  result.left = left;
  result.top = top;
  result.buffer = bitmap->buffer;
}

/*
 * Renders one glyph the way _ensure_glyph does. `xshift` is the sub-pixel shift in 26.6
 * ((variant << 4) for quarter pixels, (variant << 5) for half pixels, 0 above 20 px).
 * Returns the FreeType error; the bitmap is in ftw_result().
 */
int EXPORT(ftw_render)(int size_handle, uint32_t glyph_index, int xshift) {
  reset_result();
  if (size_handle < 1 || size_handle > size_count) return result.error = FT_Err_Invalid_Size_Handle;
  FtwSize* fs = &sizes[size_handle - 1];
  FtwFace* owner = &faces[fs->face];
  FT_Face face = owner->face;
  FT_Activate_Size(fs->size);

  FT_Int32 flags = FT_LOAD_DEFAULT;
  int outline = fs->outline > 0;
  switch (owner->hinting) {
    case FTW_HINTING_NONE:
      flags |= FT_LOAD_NO_HINTING;
      break;
    case FTW_HINTING_LIGHT:
      flags |= FT_LOAD_TARGET_LIGHT;
      break;
    default:
      flags |= FT_LOAD_TARGET_NORMAL;
      break;
  }
  if (owner->force_autohinter) flags |= FT_LOAD_FORCE_AUTOHINT;
  if (outline || (owner->disable_embedded_bitmaps && !FT_HAS_COLOR(face))) flags |= FT_LOAD_NO_BITMAP;
  else if (FT_HAS_COLOR(face)) flags |= FT_LOAD_COLOR;

  FT_Fixed h = 0, v = 0;
  FT_Get_Advance(face, glyph_index, flags, &h);
  FT_Get_Advance(face, glyph_index, flags | FT_LOAD_VERTICAL_LAYOUT, &v);
  result.advance_h = (int32_t)h;
  result.advance_v = (int32_t)v;

  int error = FT_Load_Glyph(face, glyph_index, flags);
  if (error) return result.error = error;

  if (xshift != 0) FT_Outline_Translate(&face->glyph->outline, xshift, 0);

  if (!outline) {
    error = FT_Render_Glyph(face->glyph, FT_RENDER_MODE_NORMAL);
    if (error) return result.error = error;
    publish(&face->glyph->bitmap, face->glyph->bitmap_left, face->glyph->bitmap_top);
    return 0;
  }

  FT_Stroker stroker;
  error = FT_Stroker_New(library, &stroker);
  if (error) return result.error = error;
  FT_Stroker_Set(stroker, (int)(fs->outline * 16.0), FT_STROKER_LINECAP_BUTT, FT_STROKER_LINEJOIN_ROUND, 0);
  FT_Glyph glyph = NULL;
  error = FT_Get_Glyph(face->glyph, &glyph);
  if (!error) error = FT_Glyph_Stroke(&glyph, stroker, 1);
  if (!error) error = FT_Glyph_To_Bitmap(&glyph, FT_RENDER_MODE_NORMAL, NULL, 1);
  FT_Stroker_Done(stroker);
  if (error) {
    if (glyph) FT_Done_Glyph(glyph);
    return result.error = error;
  }
  stroked = glyph;
  FT_BitmapGlyph bitmap = (FT_BitmapGlyph)glyph;
  publish(&bitmap->bitmap, bitmap->left, bitmap->top);
  return 0;
}

/* FT_Get_Char_Index, for tools and tests. */
uint32_t EXPORT(ftw_char_index)(int face_handle, uint32_t code) {
  if (face_handle < 1 || face_handle > face_count) return 0;
  return FT_Get_Char_Index(faces[face_handle - 1].face, code);
}
