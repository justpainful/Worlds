#ifndef WORLDS_COLLABORATION_H
#define WORLDS_COLLABORATION_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct WorldsDoc WorldsDoc;
typedef struct { uint8_t *data; size_t len; } WorldsBuffer;
/* A document is owned by its caller. Do not free while any call is in flight.
   Return codes are 0 success, 1 invalid input, 2 operation failure.
   Each successful output must be released exactly once with worlds_buffer_free.
   Pointers and byte ranges passed to these functions must remain valid. */
WorldsDoc *worlds_doc_new(void);
void worlds_doc_free(WorldsDoc *doc);
int32_t worlds_doc_apply(const WorldsDoc *doc, const uint8_t *data, size_t len);
int32_t worlds_doc_state_vector(const WorldsDoc *doc, WorldsBuffer *out);
int32_t worlds_doc_diff(const WorldsDoc *doc, const uint8_t *state_vector, size_t len, WorldsBuffer *out);
void worlds_buffer_free(WorldsBuffer buffer);
#ifdef __cplusplus
}
#endif
#endif
