(module
  ;; Import a function from JavaScript named `imported_func`
  ;; which takes a single i32 argument and assign to
  ;; variable $i
  (func $i (import "imports" "imported_func") (param i32))
  ;; Export a function named `exported_func` which takes a
  ;; single i32 argument and returns an i32
  (func (export "exported_func") (param $input i32) (result i32)
    ;; Invoke `imported_func` with $input as argument
    local.get $input
    call $i
    ;; Return $input
    local.get $input
    return
  )
)
