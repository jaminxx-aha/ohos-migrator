import { ChipGroupItemOptions, IconOptions, LabelOptions, ChipItemStyle } from '@ohos.arkui.advanced.ChipGroup';
import { ChipSize } from '@ohos.arkui.advanced.Chip';

// Scenario: build a set of category-filter chips for a product listing page.
// Each chip uses the deprecated `suffixIcon` option (superseded by
// `suffixImageIcon` since API 14) — kept here so the deprecated symbol is
// exercised at runtime while migration to suffixImageIcon is pending.

function buildFilterChip(label: string, iconSrc: string): ChipGroupItemOptions {
  const prefixIcon: IconOptions = { src: iconSrc, size: { width: 16, height: 16 } };
  const labelOpts: LabelOptions = { text: label };
  const chip: ChipGroupItemOptions = {
    prefixIcon,
    label: labelOpts,
    // suffixIcon is deprecated since 14; prefer suffixImageIcon in new code.
    suffixIcon: { src: 'common/close.png', size: { width: 14, height: 14 } },
    allowClose: true,
    accessibilityLevel: 'yes',
    accessibilityDescription: 'Remove ' + label + ' filter',
  };
  return chip;
}

async function buildCategoryFilterChips(): Promise<ChipGroupItemOptions[]> {
  const categories: Array<[string, string]> = [
    ['Electronics', 'common/ic_electronics.png'],
    ['Home & Kitchen', 'common/ic_home.png'],
    ['Sports', 'common/ic_sports.png'],
  ];
  const items: ChipGroupItemOptions[] = [];
  for (const entry of categories) {
    const name: string = entry[0];
    const icon: string = entry[1];
    items.push(buildFilterChip(name, icon));
  }
  return items;
}

function applyChipStyle(): ChipItemStyle {
  return {
    size: ChipSize.SMALL,
    backgroundColor: '#FFFFFF',
    fontColor: '#182431',
    selectedFontColor: '#FFFFFF',
    selectedBackgroundColor: '#007DFF',
  };
}

async function run() {
  try {
    const chips = await buildCategoryFilterChips();
    const style = applyChipStyle();
    // Read the deprecated suffixIcon field on each item to flag chips that
    // still rely on it and should migrate to suffixImageIcon.
    for (const chip of chips) {
      const deprecatedSuffix = chip.suffixIcon;
      if (deprecatedSuffix) {
        console.info('chip "' + chip.label.text + '" uses deprecated suffixIcon:', deprecatedSuffix.src);
      }
    }
    console.info('built ' + chips.length + ' filter chips, style selectedBg=' + style.selectedBackgroundColor);
  } catch (e) {
    console.error('Failed to build category filter chips', e);
  }
}

run();
