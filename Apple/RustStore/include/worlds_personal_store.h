#ifndef WORLDS_PERSONAL_STORE_H
#define WORLDS_PERSONAL_STORE_H
#include <stddef.h>
#include <stdint.h>
/* request is UTF-8 JSON. Response belongs to Rust; free it exactly once. */
char *worlds_store_call(const uint8_t *request, size_t length);
void worlds_store_free(char *response);
#endif
