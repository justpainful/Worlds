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
typedef struct WorldsStore WorldsStore;
/* Store status: 0 success, 1 invalid input, 2 failure, 3 denied, 4 unsupported schema.
   All strings must be NUL-terminated UTF-8. Do not free a store while calls are active. */
int32_t worlds_store_open(const char *path, const char *page, const char *user, const char *workspace, WorldsStore **out);
void worlds_store_free(WorldsStore *store);
/* Load packs an LE uint64 count followed by LE uint64 length and bytes per update.
   The output is freed using worlds_buffer_free. */
int32_t worlds_store_load(const WorldsStore *store, int64_t channel, WorldsBuffer *out);
int32_t worlds_store_append(const WorldsStore *store, int64_t channel, const uint8_t *data, size_t len, int32_t local);
int32_t worlds_store_max_pending(const WorldsStore *store, int64_t channel, int64_t *out);
int32_t worlds_store_ack(const WorldsStore *store, int64_t channel, int64_t through);
int32_t worlds_store_reject(const WorldsStore *store, int64_t channel, const char *archive_id, const uint8_t *state, size_t len, const char *reason);
#ifdef __cplusplus
}
#endif
#endif

