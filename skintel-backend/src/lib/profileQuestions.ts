/**
 * Profile questions schema for "Tell Us A Bit More About You" feature
 * These questions are stored in OnboardingAnswer table with screen_id: 'screen_profile_additional'
 */

export interface ProfileQuestion {
    question_id: string;
    question_text: string;
    type: 'single' | 'slider';
    options?: string[];
    min_value?: number;
    max_value?: number;
    default_value?: number;
}

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
    {
        question_id: 'q_profile_sleep_hours',
        question_text: 'How many hours of sleep do you usually get?',
        type: 'single',
        options: ['less_than_3_hrs', '3_to_6_hrs', 'greater_than_8_hrs']
    },
    {
        question_id: 'q_profile_exercise_frequency',
        question_text: 'How often do you exercise weekly?',
        type: 'single',
        options: ['never', 'once', 'greater_than_3_days']
    },
    {
        question_id: 'q_profile_water_intake',
        question_text: 'How many glasses of water do you drink daily?',
        type: 'slider',
        min_value: 1,
        max_value: 15,
        default_value: 7
    },
    {
        question_id: 'q_profile_diet_type',
        question_text: 'Do you follow any specific diet',
        type: 'single',
        options: ['veg', 'non_veg', 'vegan']
    }
];

export const PROFILE_SCREEN_ID = 'screen_profile_additional';

export const PROFILE_QUESTION_IDS = PROFILE_QUESTIONS.map(q => q.question_id);

/**
 * Get a profile question by its ID
 */
export function getProfileQuestion(questionId: string): ProfileQuestion | undefined {
    return PROFILE_QUESTIONS.find(q => q.question_id === questionId);
}

/**
 * Validate a profile question value
 */
export function validateProfileQuestionValue(questionId: string, value: any): boolean {
    const question = getProfileQuestion(questionId);
    if (!question) return false;

    if (question.type === 'single') {
        return typeof value === 'string' && question.options!.includes(value);
    }

    if (question.type === 'slider') {
        return typeof value === 'number' &&
            value >= question.min_value! &&
            value <= question.max_value!;
    }

    return false;
}

/**
 * Convert underscore-separated option to readable format
 */
export function formatOptionLabel(option: string): string {
    return option
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Map options array to include both value and label
 */
export function mapOptionsWithLabels(options: string[]): Array<{ value: string; label: string }> {
    return options.map(option => ({
        value: option,
        label: formatOptionLabel(option)
    }));
}
