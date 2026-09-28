/*
 * FreeType's system layer for ftw: memory from the C allocator, no file streams (fonts arrive as
 * memory blocks), so the module needs nothing from its host. Replaces src/base/ftsystem.c.
 * Compressed containers (WOFF, SVG documents) are refused: the game ships plain TrueType files.
 */
#include <stdlib.h>

#include <ft2build.h>
#include FT_CONFIG_CONFIG_H
#include <freetype/internal/ftdebug.h>
#include <freetype/internal/ftstream.h>
#include <freetype/ftsystem.h>
#include <freetype/fterrors.h>
#include <freetype/fttypes.h>
#include <freetype/ftgzip.h>

static void* ftw_alloc(FT_Memory memory, long size) {
  FT_UNUSED(memory);
  return malloc((size_t)size);
}

static void* ftw_realloc(FT_Memory memory, long current, long wanted, void* block) {
  FT_UNUSED(memory);
  FT_UNUSED(current);
  return realloc(block, (size_t)wanted);
}

static void ftw_release(FT_Memory memory, void* block) {
  FT_UNUSED(memory);
  free(block);
}

FT_BASE_DEF(FT_Error)
FT_Stream_Open(FT_Stream stream, const char* pathname) {
  FT_UNUSED(stream);
  FT_UNUSED(pathname);
  return FT_THROW(Cannot_Open_Resource);
}

FT_BASE_DEF(FT_Memory)
FT_New_Memory(void) {
  FT_Memory memory = (FT_Memory)malloc(sizeof(*memory));
  if (memory) {
    memory->user = NULL;
    memory->alloc = ftw_alloc;
    memory->realloc = ftw_realloc;
    memory->free = ftw_release;
  }
  return memory;
}

FT_BASE_DEF(void)
FT_Done_Memory(FT_Memory memory) {
  free(memory);
}

FT_EXPORT_DEF(FT_Error)
FT_Gzip_Uncompress(FT_Memory memory, FT_Byte* output, FT_ULong* output_len, const FT_Byte* input, FT_ULong input_len) {
  FT_UNUSED(memory);
  FT_UNUSED(output);
  FT_UNUSED(output_len);
  FT_UNUSED(input);
  FT_UNUSED(input_len);
  return FT_THROW(Unimplemented_Feature);
}
