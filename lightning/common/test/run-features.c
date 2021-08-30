#include "../features.c"
#include <ccan/err/err.h>
#include <ccan/mem/mem.h>
#include <ccan/str/hex/hex.h>
#include <common/utils.h>
#include <stdio.h>
#include <wally_core.h>

/* AUTOGENERATED MOCKS START */
/* AUTOGENERATED MOCKS END */

int main(void)
{
	u8 *bits, *lf, *gf;

	setup_locale();
	wally_init(0);
	secp256k1_ctx = wally_get_secp_context();
	setup_tmpctx();

	bits = tal_arr(tmpctx, u8, 0);
	for (size_t i = 0; i < 100; i += 3)
		set_bit(&bits, i);
	for (size_t i = 0; i < 100; i++)
		assert(test_bit(bits, i / 8, i % 8) == ((i % 3) == 0));

	for (size_t i = 0; i < 100; i++)
		assert(feature_set(bits, i) == ((i % 3) == 0));

	/* Simple test: single byte */
	bits = tal_arr(tmpctx, u8, 1);

	/* Compulsory feature */
	bits[0] = (1 << 0);
	assert(feature_offered(bits, 0));
	assert(!feature_offered(bits, 2));
	assert(!feature_offered(bits, 8));
	assert(!feature_offered(bits, 16));

	/* Optional feature */
	bits[0] = (1 << 1);
	assert(feature_offered(bits, 0));
	assert(!feature_offered(bits, 2));
	assert(!feature_offered(bits, 8));
	assert(!feature_offered(bits, 16));

	/* Endian-sensitive test: big-endian means we frob last byte here */
	bits = tal_arrz(tmpctx, u8, 2);

	bits[1] = (1 << 0);
	assert(feature_offered(bits, 0));
	assert(!feature_offered(bits, 2));
	assert(!feature_offered(bits, 8));
	assert(!feature_offered(bits, 16));

	/* Optional feature */
	bits[1] = (1 << 1);
	assert(feature_offered(bits, 0));
	assert(!feature_offered(bits, 2));
	assert(!feature_offered(bits, 8));
	assert(!feature_offered(bits, 16));

	/* We always support no features. */
	memset(bits, 0, tal_count(bits));
	assert(features_supported(bits, bits));

	/* We must support our own features. */
	lf = get_offered_globalfeatures(tmpctx);
	gf = get_offered_globalfeatures(tmpctx);
	assert(features_supported(gf, lf));

	/* We can add random odd features, no problem. */
	for (size_t i = 1; i < 16; i += 2) {
		bits = tal_dup_arr(tmpctx, u8, lf, tal_count(lf), 0);
		set_bit(&bits, i);
		assert(features_supported(gf, bits));

		bits = tal_dup_arr(tmpctx, u8, gf, tal_count(gf), 0);
		set_bit(&bits, i);
		assert(features_supported(bits, lf));
	}

	/* We can't add random even features. */
	for (size_t i = 0; i < 16; i += 2) {
		bits = tal_dup_arr(tmpctx, u8, lf, tal_count(lf), 0);
		set_bit(&bits, i);

		/* Special case for missing compulsory feature */
		if (i == 2) {
			assert(!features_supported(gf, bits));
		} else {
			assert(features_supported(gf, bits)
			       == feature_supported(i, our_localfeatures,
						    ARRAY_SIZE(our_localfeatures)));
		}

		bits = tal_dup_arr(tmpctx, u8, gf, tal_count(gf), 0);
		set_bit(&bits, i);
		assert(features_supported(bits, lf)
		       == feature_supported(i, our_globalfeatures,
					    ARRAY_SIZE(our_globalfeatures)));
	}

	wally_cleanup(0);
	tal_free(tmpctx);
	return 0;
}