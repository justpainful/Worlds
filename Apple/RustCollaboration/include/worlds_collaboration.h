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
int32_t worlds_doc_client_id(const WorldsDoc *doc, uint64_t *out);
int32_t worlds_doc_apply(const WorldsDoc *doc, const uint8_t *data, size_t len);
int32_t worlds_doc_state_vector(const WorldsDoc *doc, WorldsBuffer *out);
int32_t worlds_doc_diff(const WorldsDoc *doc, const uint8_t *state_vector, size_t len, WorldsBuffer *out);
void worlds_buffer_free(WorldsBuffer buffer);
typedef struct WorldsStore WorldsStore;
/* Store status: 0 success, 1 invalid input, 2 failure, 3 denied, 4 unsupported schema.
   All strings must be NUL-terminated UTF-8. Do not free a store while calls are active. */
int32_t worlds_store_open(const char *path, const char *page, const char *user, const char *workspace, WorldsStore **out);
void worlds_collaboration_store_free(WorldsStore *store);
/* Load packs an LE uint64 count followed by LE uint64 length and bytes per update.
   The output is freed using worlds_buffer_free. */
int32_t worlds_store_load(const WorldsStore *store, int64_t channel, WorldsBuffer *out);
int32_t worlds_store_append(const WorldsStore *store, int64_t channel, const uint8_t *data, size_t len, int32_t local);
/* Experimental: compare complete base and permissions, then commit log and outbox together.
   Status 5 means stale base. Output must be freed on success. */
int32_t worlds_store_insert_plain_checked(const WorldsStore *store, const uint8_t *base, size_t base_len,
    uint32_t block_index, const char *block_id, const char *expected, uint32_t offset,
    const char *insert, WorldsBuffer *out);
int32_t worlds_store_max_pending(const WorldsStore *store, int64_t channel, int64_t *out);
int32_t worlds_store_ack(const WorldsStore *store, int64_t channel, int64_t through);
int32_t worlds_store_reject(const WorldsStore *store, int64_t channel, const char *archive_id, const uint8_t *state, size_t len, const char *reason);
/* Read-only archived Yjs update; output must be freed on success. */
int32_t worlds_store_rejected_read(const WorldsStore *store, const char *archive_id, WorldsBuffer *out);
int32_t worlds_store_rejected_read_channel(const WorldsStore *store, const char *archive_id, int64_t channel, WorldsBuffer *out);
/* LE u64 count, u8 has-next, then each item's LE u64 id length, UTF-8 id,
   LE i64 channel/time/size, LE u64 reason length and UTF-8 reason. */
int32_t worlds_store_rejected_list(const WorldsStore *store, int32_t has_before, int64_t before_time, const char *before_id, WorldsBuffer *out);
/* Read-only JSON extraction; caller must authenticate owner and release output. */
int32_t worlds_rejected_comments(const uint8_t *data, size_t len, const char *owner, WorldsBuffer *out);
#ifdef __cplusplus
}
#endif
#endif

