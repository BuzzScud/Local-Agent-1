// The Metal patch as text, so the one-file `bonsai` binary carries it: the same bytes as
// pq2-multicol.patch (a test checks). Made by make-patch.mjs; do not edit by hand.
export const PATCH = `diff --git a/ggml/src/ggml-metal/ggml-metal-device.cpp b/ggml/src/ggml-metal/ggml-metal-device.cpp
index 3420ba8..ffe7833 100644
--- a/ggml/src/ggml-metal/ggml-metal-device.cpp
+++ b/ggml/src/ggml-metal/ggml-metal-device.cpp
@@ -882,6 +882,15 @@ ggml_metal_pipeline_with_params ggml_metal_library_get_pipeline_mul_mm(ggml_meta
     return res;
 }
 
+// PQ2_0 mat-vec for 2..8 columns (kernel_mul_mv_pq2_0_multicol): on by default,
+// GGML_METAL_PQ2_MULTICOL=0 turns it off (then the generic mul_mv_ext path runs).
+bool ggml_metal_pq2_multicol_enabled(const ggml_tensor * op) {
+    static const bool enabled = !(getenv("GGML_METAL_PQ2_MULTICOL") && atoi(getenv("GGML_METAL_PQ2_MULTICOL")) == 0);
+    return enabled && op->src[0]->type == GGML_TYPE_PQ2_0 && op->src[1]->type == GGML_TYPE_F32 &&
+           op->src[0]->ne[0] % ggml_blck_size(GGML_TYPE_PQ2_0) == 0 && op->src[1]->nb[0] == sizeof(float) &&
+           op->src[1]->ne[1] >= 2 && op->src[1]->ne[1] <= 8;
+}
+
 bool ggml_metal_ptq1_multicol_enabled(const ggml_tensor * op) {
     static const bool enabled = getenv("GGML_METAL_PTQ1_MULTICOL") && atoi(getenv("GGML_METAL_PTQ1_MULTICOL")) == 1;
     return enabled && op->src[0]->type == GGML_TYPE_PTQ1_0 && op->src[1]->type == GGML_TYPE_F32 &&
@@ -907,6 +916,7 @@ ggml_metal_pipeline_with_params ggml_metal_library_get_pipeline_mul_mv(ggml_meta
 
     const char * suffix = "";
     char ptq1_suffix[16];
+    char pq2_suffix[16];
 
     // use custom matrix x vector kernel
     switch (tsrc0) {
@@ -953,6 +963,20 @@ ggml_metal_pipeline_with_params ggml_metal_library_get_pipeline_mul_mv(ggml_meta
             {
                 nsg = N_SG_PQ2_0;
                 nr0 = N_R0_PQ2_0;
+                if (ggml_metal_pq2_multicol_enabled(op)) {
+                    // rows per simdgroup and the most columns per pass (see kernel_mul_mv_pq2_0_multicol);
+                    // GGML_METAL_PQ2_MC_NR0 (4|8) and GGML_METAL_PQ2_MC_MAXC (2..8, 3+ needs NR0=4) retune it
+                    static const int mc_nr0  = getenv("GGML_METAL_PQ2_MC_NR0")  ? atoi(getenv("GGML_METAL_PQ2_MC_NR0"))  : 8;
+                    static const int mc_maxc = getenv("GGML_METAL_PQ2_MC_MAXC") ? atoi(getenv("GGML_METAL_PQ2_MC_MAXC")) : 2;
+                    nr0 = mc_nr0 == 4 ? 4 : 8;
+                    nsg = 2;
+                    const int maxc   = std::max(2, std::min(mc_maxc, nr0 == 8 ? 4 : 8));
+                    const int groups = (ne11 + maxc - 1)/maxc;
+                    nr1 = std::max(2, (int) ((ne11 + groups - 1)/groups)); // balanced groups; a tail column is masked
+                    snprintf(pq2_suffix, sizeof(pq2_suffix), "_mc_r%d_c%d", nr0, nr1);
+                    suffix = pq2_suffix;
+                }
+
             } break;
         case GGML_TYPE_PTQ1_0:
             {
diff --git a/ggml/src/ggml-metal/ggml-metal-device.h b/ggml/src/ggml-metal/ggml-metal-device.h
index 0d30588..8d62831 100644
--- a/ggml/src/ggml-metal/ggml-metal-device.h
+++ b/ggml/src/ggml-metal/ggml-metal-device.h
@@ -7,6 +7,7 @@ extern "C" {
 #endif
 
 bool ggml_metal_ptq1_multicol_enabled(const struct ggml_tensor * op);
+bool ggml_metal_pq2_multicol_enabled(const struct ggml_tensor * op);
 
 struct ggml_metal_buffer_id {
     void * metal; // id<MTLBuffer>
diff --git a/ggml/src/ggml-metal/ggml-metal-ops.cpp b/ggml/src/ggml-metal/ggml-metal-ops.cpp
index c41bae4..adab5a8 100644
--- a/ggml/src/ggml-metal/ggml-metal-ops.cpp
+++ b/ggml/src/ggml-metal/ggml-metal-ops.cpp
@@ -2799,7 +2799,7 @@ int ggml_metal_op_mul_mat(ggml_metal_op_t ctx, int idx) {
            op->src[0]->type == GGML_TYPE_BF16 ||
            (op->src[0]->type == GGML_TYPE_Q1_0 && q1_0_ext_enable) ||
            op->src[0]->type == GGML_TYPE_Q2_0 ||
-           op->src[0]->type == GGML_TYPE_PQ2_0 ||
+           (op->src[0]->type == GGML_TYPE_PQ2_0 && !ggml_metal_pq2_multicol_enabled(op)) ||
            (op->src[0]->type == GGML_TYPE_PTQ1_0 && !ggml_metal_ptq1_multicol_enabled(op)) ||
            op->src[0]->type == GGML_TYPE_Q4_0 ||
            op->src[0]->type == GGML_TYPE_Q4_1 ||
diff --git a/ggml/src/ggml-metal/kernels/mul_mv.metal b/ggml/src/ggml-metal/kernels/mul_mv.metal
index 7d3bbc0..8a63100 100644
--- a/ggml/src/ggml-metal/kernels/mul_mv.metal
+++ b/ggml/src/ggml-metal/kernels/mul_mv.metal
@@ -1282,6 +1282,124 @@ kernel void kernel_mul_mv_pq2_0_f32(
     kernel_mul_mv_pq2_0_f32_impl<N_R0_PQ2_0, constant ggml_metal_kargs_mul_mv &>(args, src0, src1, dst, nullptr, tgpig, tiisg, sgitg);
 }
 
+// PQ2_0 mat-vec for 2..8 columns: checking speculative drafts and small batches in one pass.
+// Same arithmetic as kernel_mul_mv_pq2_0_f32_impl (base-4 collapse coefficients, floor
+// chain), but each weight byte is decoded once and reused for nr1 columns. Each thread
+// takes 8 weights (2 bytes) of a block, so a column's coefficients need 8 registers and a
+// simdgroup covers two blocks per step. Columns past ne11 are staged as zero and never
+// written, so 5..8 columns run as balanced groups. Measured on an M4 (10-core GPU) at
+// 17408 x 5120: nr0 = 8 rows and nr1 = 2 columns per pass is fastest (1, 2, 4, 8
+// columns: 256, 319, 597, 1177 us; mul_mv_ext took 256, ~500, 930-1430, 1750-3100 us
+// across runs); larger nr0 * nr1 run out of registers and get slower.
+template<int nr0, int nr1>
+kernel void kernel_mul_mv_pq2_0_multicol(
+        constant ggml_metal_kargs_mul_mv & args,
+        device const char * src0,
+        device const char * src1,
+        device       char * dst,
+        uint3  tgpig[[threadgroup_position_in_grid]],
+        ushort tiisg[[thread_index_in_simdgroup]],
+        ushort sgitg[[simdgroup_index_in_threadgroup]]) {
+    const short NSG = FC_mul_mv_nsg;
+
+    const int nb = args.ne00/QK_PQ2_0;
+
+    const int r0 = tgpig.x;
+    const int r1 = tgpig.y * nr1;
+    const int im = tgpig.z;
+
+    const int first_row = (r0 * NSG + sgitg) * nr0;
+    const int ncols     = min(nr1, (int) args.ne11 - r1);
+
+    const uint i12 = im%FC_mul_mv_ne12;
+    const uint i13 = im/FC_mul_mv_ne12;
+
+    const uint64_t offset1 = r1*args.nb11 + (i12)*args.nb12 + (i13)*args.nb13;
+
+    device const float * y = (device const float *) (src1 + offset1);
+
+    device const block_pq2_0 * ax[nr0];
+    for (int row = 0; row < nr0; ++row) {
+        const uint64_t offset0 = min(first_row + row, args.ne01 - 1)*args.nb01 + (i12/FC_mul_mv_r2)*args.nb02 + (i13/FC_mul_mv_r3)*args.nb03;
+        ax[row] = (device const block_pq2_0 *) ((device char *) src0 + offset0);
+    }
+
+    float sumf[nr0][nr1] = {};
+
+    // 16 threads per block, 8 weights (2 bytes) each; two blocks per simdgroup step
+    const short ix = (tiisg/16);
+    const short il = (tiisg%16)*8;
+
+    device const float * yb = y + ix*QK_PQ2_0 + il;
+
+    for (int ib = ix; ib < nb; ib += 2) {
+        float yl[nr1][8];
+        float sumy[nr1];
+        FOR_UNROLL (short col = 0; col < nr1; ++col) {
+            sumy[col] = 0.f;
+            if (col < ncols) {
+                device const float4 * yc = (device const float4 *) ((device const char *) yb + col*args.nb11);
+                FOR_UNROLL (short j = 0; j < 2; j++) {
+                    const float4 v = yc[j];
+                    sumy[col] += (v.x + v.y) + (v.z + v.w);
+                    yl[col][4*j + 0] = v.w - 4.0f*v.z;
+                    yl[col][4*j + 1] = v.z - 4.0f*v.y;
+                    yl[col][4*j + 2] = v.y - 4.0f*v.x;
+                    yl[col][4*j + 3] = v.x;
+                }
+            } else {
+                FOR_UNROLL (short k = 0; k < 8; k++) {
+                    yl[col][k] = 0.f;
+                }
+            }
+        }
+
+        FOR_UNROLL (short row = 0; row < nr0; row++) {
+            device const block_pq2_0 * qb = ax[row] + ib;
+            device const uint8_t * qs = qb->qs + (il / 4);
+
+            float acc[nr1] = {};
+            FOR_UNROLL (short j = 0; j < 2; j++) {
+                const float b  = (float) qs[j];
+                const float u  = b * (1.0f/256.0f);
+                const float g1 = floor( 4.0f*u);
+                const float g2 = floor(16.0f*u);
+                const float g3 = floor(64.0f*u);
+                FOR_UNROLL (short col = 0; col < nr1; ++col) {
+                    acc[col] += g1*yl[col][4*j + 0];
+                    acc[col] += g2*yl[col][4*j + 1];
+                    acc[col] += g3*yl[col][4*j + 2];
+                    acc[col] +=  b*yl[col][4*j + 3];
+                }
+            }
+
+            const float d = (float) qb->d;
+            FOR_UNROLL (short col = 0; col < nr1; ++col) {
+                sumf[row][col] += d * (acc[col] - sumy[col]);
+            }
+        }
+
+        yb += 2*QK_PQ2_0;
+    }
+
+    device float * dst_f32 = (device float *) dst + (uint64_t)im*args.ne0*args.ne1 + (uint64_t)r1*args.ne0;
+
+    for (int row = 0; row < nr0; ++row) {
+        FOR_UNROLL (short col = 0; col < nr1; ++col) {
+            const float tot = simd_sum(sumf[row][col]);
+            if (tiisg == 0 && first_row + row < args.ne01 && col < ncols) {
+                dst_f32[(uint64_t) col*args.ne0 + first_row + row] = tot;
+            }
+        }
+    }
+}
+
+typedef decltype(kernel_mul_mv_pq2_0_multicol<8, 2>) mul_mv_pq2_multicol_t;
+#define PQ2_MC(R, C) template [[host_name("kernel_mul_mv_pq2_0_f32_mc_r" #R "_c" #C)]] kernel mul_mv_pq2_multicol_t kernel_mul_mv_pq2_0_multicol<R, C>;
+PQ2_MC(8, 2) PQ2_MC(8, 3) PQ2_MC(8, 4)
+PQ2_MC(4, 2) PQ2_MC(4, 3) PQ2_MC(4, 4) PQ2_MC(4, 5) PQ2_MC(4, 6) PQ2_MC(4, 7) PQ2_MC(4, 8)
+#undef PQ2_MC
+
 kernel void kernel_mul_mv_q4_0_f32(
         constant ggml_metal_kargs_mul_mv & args,
         device const char * src0,
`;
