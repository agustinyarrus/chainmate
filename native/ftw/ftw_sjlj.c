/*
 * setjmp/longjmp runtime for WebAssembly exception handling: the three helpers clang's SjLj lowering
 * calls (-mllvm -wasm-enable-sjlj). Same contract as wasi-libc's libsetjmp (rt.c).
 */
#include <stddef.h>
#include <stdint.h>

struct jmp_buf_impl {
  void* func_invocation_id;
  uint32_t label;
  struct arg {
    void* env;
    int val;
  } arg;
};

void __wasm_setjmp(void* env, uint32_t label, void* func_invocation_id) {
  struct jmp_buf_impl* jb = env;
  if (label == 0 || func_invocation_id == NULL) __builtin_trap();
  jb->func_invocation_id = func_invocation_id;
  jb->label = label;
}

uint32_t __wasm_setjmp_test(void* env, void* func_invocation_id) {
  struct jmp_buf_impl* jb = env;
  if (jb->label == 0 || func_invocation_id == NULL) __builtin_trap();
  return jb->func_invocation_id == func_invocation_id ? jb->label : 0;
}

void __wasm_longjmp(void* env, int val) {
  struct jmp_buf_impl* jb = env;
  struct arg* arg = &jb->arg;
  if (val == 0) val = 1;
  arg->env = env;
  arg->val = val;
  __builtin_wasm_throw(1, arg); /* 1 = C_LONGJMP */
}
