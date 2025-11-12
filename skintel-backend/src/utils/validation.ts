export const VALID_QUESTION_IDS = [
  'q_skin_concerns',
  'q_skin_sensitivity', 
  'q_skin_type',
  'q_goal',
  'q_profile_gender',
  'q_age',
  'q_profile_ethnicity',
  'q_time_spent_outdoors',
  'q_profile_sun_exposure',
  'q_profile_weather_conditions',
  'q_regime_product',
  'q_medical_conditions',
  'q_hormone_factors',
  'q_face_photo_front',
  'q_face_photo_left',
  'q_face_photo_right',
  'q_skin_closeup',
  'q_onboarding_complete',
  'q_onboarding_status'
] as const;

export const QUESTION_TYPES = {
  q_skin_concerns: 'multi',
  q_skin_sensitivity: 'single',
  q_skin_type: 'single',
  q_goal: 'multi',
  q_profile_gender: 'single',
  q_age: 'slider',
  q_profile_ethnicity: 'single',
  q_time_spent_outdoors: 'single',
  q_profile_weather_conditions: 'single',
  q_regime_product: 'multi',
  q_medical_conditions: 'multi',
  q_hormone_factors: 'multi',
  q_face_photo_front: 'image',
  q_face_photo_left: 'image',
  q_face_photo_right: 'image',
  q_skin_closeup: 'image',
  q_onboarding_complete: 'boolean',
  q_onboarding_status: 'derived'
} as const;

// Specific valid values for each question
export const VALID_VALUES = {
  q_skin_concerns: [
    'acne', 'dark_spots', 'wrinkles', 'fine_lines', 'dryness', 'oiliness',
    'redness', 'sensitivity', 'dullness', 'aging',
    'hyperpigmentation', 'blackheads', 'whiteheads', 'scarring','pores_and_texture'
  ],
  q_skin_sensitivity: [
    'not_sensitive', 'mildly_sensitive', 'very_sensitive', 'not_sure'],
  q_skin_type: [
    'oily', 'dry', 'combination', 'normal', 'dehydrated'
  ],
  q_goal: [
    'healthy_glow', 'clear_skin', 'hydration', 'anti_aging', 'brightening', 'oil_control',
    'pore_minimizing', 'acne_treatment', 'even_skin_tone', 'sun_protection', 'clear_and_blemish_free', 'even_tone','smooth_texture','hydrated_and_plump'
  ],
  q_profile_gender: ['female', 'male', 'nonbinary', 'prefer_not_to_say','female_pregnant'],
  q_profile_ethnicity: [
    'east_asian', 'black', 'hispanic', 'white', 'middle_eastern', 'native_american', 'south_asian', 'african_descent',
    'pacific_islander', 'mixed', 'south_east_asian','indigenious_australian' ,'prefer_not_to_say'
  ],
  q_time_spent_outdoors: [ '0_to_1_hr', '1_to_3_hours', 'more_than_3_hours' ],
  q_profile_weather_conditions: ['hot', 'temperate', 'cold', 'minus_10_to_15_celsius', '6_to_29_celsius', '30_celsius_and_above'],
  q_medical_conditions: [
    'eczema', 'psoriasis', 'rosacea', 'contact_dermatitis', 'allergies', 'medications',
    'pcos', 'seborrheic_dermatitis', 'none', 'other'
  ],
  q_hormone_factors: [
    'pregnancy', 'menopause', 'pms', 'puberty', 'hormonal_acne',
    'birth_control', 'hormone_therapy', 'high_stress', 'none'
  ]
} as const;

export const AGE_RANGE = { min: 13, max: 99 };

export const isValidQuestionId = (questionId: string): boolean => {
  return VALID_QUESTION_IDS.includes(questionId as any);
};

export const getExpectedType = (questionId: string): string | null => {
  return QUESTION_TYPES[questionId as keyof typeof QUESTION_TYPES] || null;
};

export const getValidValues = (questionId: string): readonly string[] | null => {
  return VALID_VALUES[questionId as keyof typeof VALID_VALUES] || null;
};

export const validateQuestionValue = (questionId: string, value: any): boolean => {
  const expectedType = getExpectedType(questionId);
  if (!expectedType) return false;

  switch (expectedType) {
    case 'single': {
      if (typeof value !== 'string') return false;
      const validValues = getValidValues(questionId);
      if (!validValues) return true;
      // this is a case insentitive matching so less strict valdiation
      return validValues.some(v => 
        v.toLowerCase().replace(/[_\s]/g, '') === value.toLowerCase().replace(/[_\s]/g, '')
      );
    }
    case 'multi': {
      if (!Array.isArray(value)) return false;
      if (value.length === 0) return true; // Allow empty arrays
      const validValues = getValidValues(questionId);
      if (!validValues) return value.every(v => typeof v === 'string');
      return value.every(v => 
        typeof v === 'string' && validValues.some(vv => 
          vv.toLowerCase().replace(/[_\s]/g, '') === v.toLowerCase().replace(/[_\s]/g, '')
        )
      );
    }
    case 'slider': {
      if (typeof value !== 'number') return false;
      if (questionId === 'q_age') {
        return value >= AGE_RANGE.min && value <= AGE_RANGE.max;
      }
      return Number.isInteger(value) && value >= 0;
    }
    case 'image': {
      if (typeof value !== 'object' || value === null) return false;
      if (typeof (value as any).image_id === 'string') {
        return (value as any).image_id.length > 0; // no more strict img_ requirement
      }
      if (typeof (value as any).image_url === 'string') {
        const url = (value as any).image_url;
        return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/');
      }
      return false;
    }
    case 'boolean': {
      return typeof value === 'boolean';
    }
    case 'derived': {
      return typeof value === 'string';
    }
    default:
      return false;
  }
};