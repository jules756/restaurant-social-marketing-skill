#!/usr/bin/env node

/**
 * knowledge-base.js - Restaurant Knowledge Base Management
 *
 * Commands:
 *   --init --dir <path>                    Create KB directory and template files
 *   --add-dish --dir <path> --data '<json>'  Add a dish to menu.json
 *   --add-recipe-story --dir <path> --data '<json>'  Add a recipe story to recipes.json
 *   --summary --dir <path>                 Show KB summary
 *   --suggest-content --dir <path>         List menu items not yet featured in posts
 *   --validate --dir <path>                Check KB completeness
 */

const fs = require('fs');
const path = require('path');

// --- Templates ---

const MENU_TEMPLATE = {
  lastUpdated: '',
  currency: 'USD',
  sections: [
    { name: 'Starters', items: [] },
    { name: 'Mains', items: [] },
    { name: 'Desserts', items: [] }
  ]
};

const HISTORY_TEMPLATE = {
  foundedYear: null,
  founders: [],
  originStory: '',
  milestones: [],
  philosophy: '',
  neighborhood: '',
  nameOrigin: ''
};

const CHEF_TEMPLATE = {
  name: '',
  title: '',
  background: '',
  specialties: [],
  signature: '',
  story: '',
  funFacts: []
};

const RECIPES_TEMPLATE = {
  recipes: []
};

// --- Argument Parsing ---

function parseArgs(argv) {
  const args = {};
  let i = 2; // skip 'node' and script path
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--init') {
      args.command = 'init';
    } else if (arg === '--add-dish') {
      args.command = 'add-dish';
    } else if (arg === '--add-recipe-story') {
      args.command = 'add-recipe-story';
    } else if (arg === '--summary') {
      args.command = 'summary';
    } else if (arg === '--suggest-content') {
      args.command = 'suggest-content';
    } else if (arg === '--validate') {
      args.command = 'validate';
    } else if (arg === '--dir' && i + 1 < argv.length) {
      args.dir = argv[++i];
    } else if (arg === '--data' && i + 1 < argv.length) {
      args.data = argv[++i];
    }
    i++;
  }
  return args;
}

// --- File Helpers ---

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// --- Commands ---

function cmdInit(dir) {
  ensureDir(dir);

  const files = {
    'menu.json': MENU_TEMPLATE,
    'history.json': HISTORY_TEMPLATE,
    'chef.json': CHEF_TEMPLATE,
    'recipes.json': RECIPES_TEMPLATE
  };

  for (const [filename, template] of Object.entries(files)) {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      writeJSON(filePath, template);
      console.log(`Created ${filePath}`);
    } else {
      console.log(`Already exists: ${filePath}`);
    }
  }

  console.log('Knowledge base initialized.');
}

function cmdAddDish(dir, dataStr) {
  if (!dataStr) {
    console.error('Error: --data is required for --add-dish');
    process.exit(1);
  }

  let dish;
  try {
    dish = JSON.parse(dataStr);
  } catch (err) {
    console.error('Error: --data must be valid JSON');
    process.exit(1);
  }

  // Apply defaults for optional fields
  const defaults = {
    ingredients: [],
    allergens: [],
    isSignature: false,
    isVegetarian: false,
    visualDescription: '',
    featuredInPosts: 0,
    lastFeatured: null
  };
  const item = { ...defaults, ...dish };

  // Validate required fields
  if (!item.name || item.price === undefined || !item.description) {
    console.error('Error: Dish must have at least name, price, and description');
    process.exit(1);
  }

  const menuPath = path.join(dir, 'menu.json');
  if (!fs.existsSync(menuPath)) {
    console.error(`Error: menu.json not found in ${dir}. Run --init first.`);
    process.exit(1);
  }

  const menu = readJSON(menuPath);

  // Determine target section
  const sectionName = dish.section || 'Mains';
  let section = menu.sections.find(
    (s) => s.name.toLowerCase() === sectionName.toLowerCase()
  );
  if (!section) {
    section = { name: sectionName, items: [] };
    menu.sections.push(section);
  }

  // Remove the helper 'section' key from the item before storing
  delete item.section;

  section.items.push(item);
  menu.lastUpdated = new Date().toISOString();
  writeJSON(menuPath, menu);

  console.log(`Added "${item.name}" to ${section.name} section.`);
}

function cmdAddRecipeStory(dir, dataStr) {
  if (!dataStr) {
    console.error('Error: --data is required for --add-recipe-story');
    process.exit(1);
  }

  let recipe;
  try {
    recipe = JSON.parse(dataStr);
  } catch (err) {
    console.error('Error: --data must be valid JSON');
    process.exit(1);
  }

  // Apply defaults
  const defaults = {
    dish: '',
    menuItem: '',
    story: '',
    culturalSignificance: '',
    specialIngredients: [],
    process: '',
    hookIdeas: []
  };
  const item = { ...defaults, ...recipe };

  if (!item.dish) {
    console.error('Error: Recipe must have at least a dish name');
    process.exit(1);
  }

  const recipesPath = path.join(dir, 'recipes.json');
  if (!fs.existsSync(recipesPath)) {
    console.error(`Error: recipes.json not found in ${dir}. Run --init first.`);
    process.exit(1);
  }

  const data = readJSON(recipesPath);
  data.recipes.push(item);
  writeJSON(recipesPath, data);

  console.log(`Added recipe story for "${item.dish}".`);
}

function cmdSummary(dir) {
  const files = ['menu.json', 'history.json', 'chef.json', 'recipes.json'];
  for (const f of files) {
    if (!fs.existsSync(path.join(dir, f))) {
      console.error(`Error: ${f} not found in ${dir}. Run --init first.`);
      process.exit(1);
    }
  }

  const menu = readJSON(path.join(dir, 'menu.json'));
  const history = readJSON(path.join(dir, 'history.json'));
  const chef = readJSON(path.join(dir, 'chef.json'));
  const recipes = readJSON(path.join(dir, 'recipes.json'));

  let totalDishes = 0;
  const sectionSummaries = [];
  for (const section of menu.sections) {
    totalDishes += section.items.length;
    sectionSummaries.push(`  ${section.name}: ${section.items.length} items`);
  }

  const signatureDishes = menu.sections
    .flatMap((s) => s.items)
    .filter((item) => item.isSignature).length;

  console.log('=== Knowledge Base Summary ===');
  console.log('');
  console.log(`Menu (last updated: ${menu.lastUpdated || 'never'})`);
  console.log(`  Total dishes: ${totalDishes}`);
  sectionSummaries.forEach((s) => console.log(s));
  console.log(`  Signature dishes: ${signatureDishes}`);
  console.log('');
  console.log('History');
  console.log(`  Founded: ${history.foundedYear || 'not set'}`);
  console.log(`  Founders: ${history.founders.length > 0 ? history.founders.join(', ') : 'not set'}`);
  console.log(`  Origin story: ${history.originStory ? 'provided' : 'missing'}`);
  console.log(`  Milestones: ${history.milestones.length}`);
  console.log('');
  console.log('Chef');
  console.log(`  Name: ${chef.name || 'not set'}`);
  console.log(`  Title: ${chef.title || 'not set'}`);
  console.log(`  Specialties: ${chef.specialties.length > 0 ? chef.specialties.join(', ') : 'none listed'}`);
  console.log(`  Fun facts: ${chef.funFacts.length}`);
  console.log('');
  console.log('Recipes');
  console.log(`  Recipe stories: ${recipes.recipes.length}`);
  if (recipes.recipes.length > 0) {
    console.log(`  Dishes covered: ${recipes.recipes.map((r) => r.dish).join(', ')}`);
  }
}

function cmdSuggestContent(dir) {
  const menuPath = path.join(dir, 'menu.json');
  if (!fs.existsSync(menuPath)) {
    console.error(`Error: menu.json not found in ${dir}. Run --init first.`);
    process.exit(1);
  }

  const menu = readJSON(menuPath);
  const unfeatured = [];

  for (const section of menu.sections) {
    for (const item of section.items) {
      if (item.featuredInPosts === 0) {
        unfeatured.push({ section: section.name, name: item.name, price: item.price });
      }
    }
  }

  if (unfeatured.length === 0) {
    console.log('All menu items have been featured in posts. Great coverage!');
    return;
  }

  console.log(`=== ${unfeatured.length} Menu Items Not Yet Featured ===`);
  console.log('');
  for (const item of unfeatured) {
    console.log(`  [${item.section}] ${item.name} ($${item.price})`);
  }
  console.log('');
  console.log('Consider creating content for these items to improve coverage.');
}

function cmdValidate(dir) {
  const files = ['menu.json', 'history.json', 'chef.json', 'recipes.json'];
  const warnings = [];
  const errors = [];

  // Check file existence
  for (const f of files) {
    if (!fs.existsSync(path.join(dir, f))) {
      errors.push(`Missing file: ${f}`);
    }
  }

  if (errors.length > 0) {
    console.log('=== Validation Results ===');
    errors.forEach((e) => console.log(`  ERROR: ${e}`));
    console.log(`\nRun --init --dir ${dir} to create missing files.`);
    process.exit(1);
  }

  const menu = readJSON(path.join(dir, 'menu.json'));
  const history = readJSON(path.join(dir, 'history.json'));
  const chef = readJSON(path.join(dir, 'chef.json'));
  const recipes = readJSON(path.join(dir, 'recipes.json'));

  // Menu validation
  const totalDishes = menu.sections.reduce((sum, s) => sum + s.items.length, 0);
  if (totalDishes === 0) {
    warnings.push('Menu has no dishes. Add items with --add-dish.');
  }
  if (!menu.lastUpdated) {
    warnings.push('Menu has never been updated (lastUpdated is empty).');
  }
  for (const section of menu.sections) {
    for (const item of section.items) {
      if (!item.description) {
        warnings.push(`Menu item "${item.name}" is missing a description.`);
      }
      if (!item.ingredients || item.ingredients.length === 0) {
        warnings.push(`Menu item "${item.name}" has no ingredients listed.`);
      }
      if (!item.visualDescription) {
        warnings.push(`Menu item "${item.name}" is missing a visual description (useful for content).`);
      }
    }
  }

  // History validation
  if (!history.foundedYear) {
    warnings.push('History: foundedYear is not set.');
  }
  if (history.founders.length === 0) {
    warnings.push('History: no founders listed.');
  }
  if (!history.originStory) {
    warnings.push('History: origin story is empty.');
  }
  if (!history.philosophy) {
    warnings.push('History: philosophy is empty.');
  }
  if (!history.neighborhood) {
    warnings.push('History: neighborhood is empty.');
  }

  // Chef validation
  if (!chef.name) {
    warnings.push('Chef: name is not set.');
  }
  if (!chef.background) {
    warnings.push('Chef: background is empty.');
  }
  if (chef.specialties.length === 0) {
    warnings.push('Chef: no specialties listed.');
  }
  if (!chef.story) {
    warnings.push('Chef: story is empty.');
  }

  // Recipes validation
  if (recipes.recipes.length === 0) {
    warnings.push('Recipes: no recipe stories yet. Add with --add-recipe-story.');
  }

  // Cross-reference: menu items without recipe stories
  const recipeDishes = new Set(recipes.recipes.map((r) => r.dish.toLowerCase()));
  const signatureDishes = menu.sections
    .flatMap((s) => s.items)
    .filter((item) => item.isSignature);
  for (const dish of signatureDishes) {
    if (!recipeDishes.has(dish.name.toLowerCase())) {
      warnings.push(
        `Signature dish "${dish.name}" has no recipe story. Consider adding one.`
      );
    }
  }

  // Output
  console.log('=== Validation Results ===');
  console.log('');
  if (warnings.length === 0) {
    console.log('Knowledge base is complete. No warnings.');
  } else {
    console.log(`Found ${warnings.length} warning(s):`);
    console.log('');
    warnings.forEach((w) => console.log(`  WARNING: ${w}`));
    console.log('');
    console.log('Fill in the missing data to improve content generation quality.');
  }
}

// --- Main ---

function main() {
  const args = parseArgs(process.argv);

  if (!args.command) {
    console.log('Usage:');
    console.log('  node knowledge-base.js --init --dir <path>');
    console.log('  node knowledge-base.js --add-dish --dir <path> --data \'<json>\'');
    console.log('  node knowledge-base.js --add-recipe-story --dir <path> --data \'<json>\'');
    console.log('  node knowledge-base.js --summary --dir <path>');
    console.log('  node knowledge-base.js --suggest-content --dir <path>');
    console.log('  node knowledge-base.js --validate --dir <path>');
    process.exit(0);
  }

  if (!args.dir) {
    console.error('Error: --dir <path> is required');
    process.exit(1);
  }

  const dir = path.resolve(args.dir);

  switch (args.command) {
    case 'init':
      cmdInit(dir);
      break;
    case 'add-dish':
      cmdAddDish(dir, args.data);
      break;
    case 'add-recipe-story':
      cmdAddRecipeStory(dir, args.data);
      break;
    case 'summary':
      cmdSummary(dir);
      break;
    case 'suggest-content':
      cmdSuggestContent(dir);
      break;
    case 'validate':
      cmdValidate(dir);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      process.exit(1);
  }
}

main();
