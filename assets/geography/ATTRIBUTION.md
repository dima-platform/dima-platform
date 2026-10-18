# Nabeul reference boundary

The DIMA launch target is Nabeul Governorate, Tunisia (user selection on 2026-10-17).

Numeric Nabeul/TN-21 boundary coordinates were extracted from the Apache Superset country-map Tunisia dataset, rounded to six decimal places, and saved as a single-feature GeoJSON. This boundary is a reference approximation. It is not a surveyed boundary, routing coverage, or evidence of store/courier availability. Manual review of addresses close to the coast or governorate boundary is required before real operations.

- [Apache Superset country maps](https://github.com/apache/superset/blob/master/superset-frontend/plugins/plugin-chart-country-map/src/countries/tunisia.geojson)
- [Versioned source mirror inspected, Superset 5.0.0rc4, June 2025](https://fossies.org/linux/apache-superset/superset-frontend/plugins/legacy-plugin-chart-country-map/src/countries/tunisia.geojson)
- [Superset map-data sourcing explanation](https://preset.io/blog/how-and-when-and-why-to-update-apache-supersets-country-maps/)
- [Natural Earth public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/)

Only geographic numeric data is used. No Superset application code or design is included. DIMA's point-in-polygon implementation is original project code. The local file is pinned in the deliverable; startup never downloads boundaries.
