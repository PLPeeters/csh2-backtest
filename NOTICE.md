# Third-party data notice

## Belgian consumer price index

Belgian CPI data is sourced from Statbel (Directorate-General Statistics – Statistics Belgium) and licensed under [CC BY 4.0](https://statbel.fgov.be/en/cc-40). The application uses data source `314984ea-123f-4c42-93e5-4942cb877795`, historical backfill view `942375c9-71d5-4d0c-9120-e051bd58b9d5`, and current published view `86586e27-90ac-47c6-87ce-64b63194e605`.

The source observations were adapted by selecting the monthly all-items series, deduplicating identical months, rebasing the current rolling series onto the stored historical scale, and normalizing the result into a sorted monthly series. CPI coverage in this project begins in January 2016. These adaptations do not imply Statbel endorsement.

Refresh the publication with `npm run refresh-cpi`. The repository workflow checks for updates each Monday at 10:30 Europe/Brussels and republishes only when the normalized CPI publication changes.

This notice applies to the Statbel dataset. The repository's `LICENSE` continues to apply to the application itself.
